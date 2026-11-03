import * as db from './store.js';
import * as auth from './auth.js';
import { makeDraw, revealOrder, DrawError } from './draw.js';

// Everything lives in a handful of Redis keys:
//   gx:meta    JSON: title, guidelines, keep-apart pairs, draw/reveal times
//   gx:people  hash: id -> { id, name, token, createdAt }
//   gx:lists   hash: id -> { link, notes, updatedAt }   (each person edits their own)
//   gx:draw    hash: giverId -> receiverId
//   gx:seen    hash: id -> time they first opened their slip
//   gx:admin   JSON: organizer password hash + session secret
const KEYS = {
  meta: 'gx:meta',
  people: 'gx:people',
  lists: 'gx:lists',
  draw: 'gx:draw',
  seen: 'gx:seen',
  admin: 'gx:admin',
  fails: 'gx:login-fails',
};

export const DEFAULT_TITLE = 'Gift Exchange';
export const DEFAULT_GUIDELINES = [
  "Don't tell anyone the name you got.",
  'Spend $100–150 minimum on the person.',
  'Bring the gift(s) wrapped in one box or bag if possible, two at the most.',
  'The reveal will happen at the end, when all the gifts have been opened.',
];

const LIMITS = {
  people: 100,
  name: 60,
  link: 2000,
  notes: 2000,
  title: 80,
  guideline: 300,
  guidelines: 12,
  password: 200,
};

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function parse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- input cleanup ----------

function oneLine(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function cleanName(v) {
  const s = oneLine(v);
  if (!s) throw new HttpError(400, 'Enter a name.');
  if (s.length > LIMITS.name) {
    throw new HttpError(400, `Keep names under ${LIMITS.name} characters.`);
  }
  return s;
}

const NOT_A_LINK =
  "That doesn't look like a web link. Copy the full address from your browser or the list's Share button.";

function cleanLink(v) {
  let s = String(v ?? '').trim();
  if (!s) return '';
  if (s.length > LIMITS.link) throw new HttpError(400, 'That link is too long.');
  // Share buttons often copy text plus a link ("Check out my list https://...").
  const found = s.match(/https?:\/\/[^\s<>"']+/i);
  if (found) s = found[0].replace(/[.,;:!?]+$/, '');
  else if (/\s/.test(s)) throw new HttpError(400, NOT_A_LINK);
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let url;
  try {
    url = new URL(s);
  } catch {
    throw new HttpError(400, NOT_A_LINK);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) {
    throw new HttpError(400, NOT_A_LINK);
  }
  return url.toString();
}

function cleanNotes(v) {
  const s = String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (s.length > LIMITS.notes) {
    throw new HttpError(400, `Keep notes under ${LIMITS.notes} characters.`);
  }
  return s;
}

function cleanTitle(v) {
  const s = oneLine(v);
  if (s.length > LIMITS.title) {
    throw new HttpError(400, `Keep the name under ${LIMITS.title} characters.`);
  }
  return s || DEFAULT_TITLE;
}

function cleanGuidelines(v) {
  const list = (Array.isArray(v) ? v : String(v ?? '').split('\n')).map(oneLine).filter(Boolean);
  if (list.length > LIMITS.guidelines) {
    throw new HttpError(400, `Keep it to ${LIMITS.guidelines} guidelines or fewer.`);
  }
  if (list.some((g) => g.length > LIMITS.guideline)) {
    throw new HttpError(400, `Keep each guideline under ${LIMITS.guideline} characters.`);
  }
  return list;
}

function cleanPassword(v) {
  const s = String(v ?? '');
  if (s.length < 6) throw new HttpError(400, 'Use at least 6 characters.');
  if (s.length > LIMITS.password) throw new HttpError(400, 'That password is too long.');
  return s;
}

// ---------- state ----------

async function load({ withAdmin = false } = {}) {
  const commands = [
    ['GET', KEYS.meta],
    ['HGETALL', KEYS.people],
    ['HGETALL', KEYS.lists],
    ['HGETALL', KEYS.draw],
    ['HGETALL', KEYS.seen],
  ];
  if (withAdmin) commands.push(['GET', KEYS.admin]);
  const [meta, people, lists, draw, seen, admin] = await db.pipeline(commands);
  const m = parse(meta) || {};
  const listMap = {};
  for (const [id, text] of Object.entries(db.hashToObject(lists))) listMap[id] = parse(text) || {};
  return {
    meta: {
      title: m.title || DEFAULT_TITLE,
      guidelines: Array.isArray(m.guidelines) ? m.guidelines : DEFAULT_GUIDELINES,
      pairs: Array.isArray(m.pairs) ? m.pairs : [],
      drawnAt: m.drawnAt || null,
      revealedAt: m.revealedAt || null,
    },
    people: Object.values(db.hashToObject(people))
      .map(parse)
      .filter((p) => p && p.id && p.name && p.token)
      .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)),
    lists: listMap,
    draw: db.hashToObject(draw),
    seen: db.hashToObject(seen),
    admin: withAdmin ? parse(admin) : undefined,
  };
}

function saveMeta(meta) {
  return ['SET', KEYS.meta, JSON.stringify(meta)];
}

function listOf(state, id) {
  const l = state.lists[id] || {};
  return { link: l.link || '', notes: l.notes || '', listUpdatedAt: l.updatedAt || null };
}

function findPerson(state, id) {
  const p = state.people.find((x) => x.id === id);
  if (!p) throw new HttpError(404, 'That person is no longer in the exchange.', 'NO_PERSON');
  return p;
}

function findByToken(state, token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 64) return null;
  return state.people.find((p) => p.token === token) || null;
}

function badLink() {
  return new HttpError(
    404,
    "This link doesn't work anymore. Ask the organizer to send you your current link.",
    'BAD_LINK'
  );
}

function revealRows(state) {
  const byId = Object.fromEntries(state.people.map((p) => [p.id, p]));
  return revealOrder(state.people, state.draw).map((r) => ({
    giver: byId[r.giverId] ? byId[r.giverId].name : 'Someone',
    receiver: byId[r.receiverId] ? byId[r.receiverId].name : 'Someone',
    loop: r.loop,
  }));
}

function siteUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return null;
  return 'https://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

// What the organizer sees. Never includes who drew whom until the reveal.
function adminView(state) {
  const drawn = !!state.meta.drawnAt;
  return {
    title: state.meta.title,
    guidelines: state.meta.guidelines,
    pairs: state.meta.pairs,
    drawnAt: state.meta.drawnAt,
    revealedAt: state.meta.revealedAt,
    siteUrl: siteUrl(),
    people: state.people.map((p) => ({
      id: p.id,
      name: p.name,
      token: p.token,
      ...listOf(state, p.id),
      openedAt: drawn && state.seen[p.id] ? Number(state.seen[p.id]) : null,
    })),
    reveal: state.meta.revealedAt ? revealRows(state) : null,
  };
}

// What one participant sees through their private link.
function participantView(state, me, { reveal = false } = {}) {
  const drawn = !!state.meta.drawnAt;
  const revealed = !!state.meta.revealedAt;
  const view = {
    title: state.meta.title,
    guidelines: state.meta.guidelines,
    me: { name: me.name, ...listOf(state, me.id) },
    peopleCount: state.people.length,
    drawn,
    revealed,
    inDraw: drawn ? !!state.draw[me.id] : null,
    recipient: null,
    reveal: null,
  };
  if (drawn && (reveal || revealed)) {
    const receiverId = state.draw[me.id];
    const r = receiverId && state.people.find((p) => p.id === receiverId);
    if (r) view.recipient = { name: r.name, ...listOf(state, r.id) };
  }
  if (revealed) view.reveal = revealRows(state);
  return view;
}

// ---------- actions anyone can call ----------

const publicActions = {
  async status() {
    const admin = await db.cmd('GET', KEYS.admin);
    return { db: true, setup: !!admin };
  },

  async setup({ password }) {
    const record = await auth.hashPassword(cleanPassword(password));
    const ok = await db.cmd('SET', KEYS.admin, JSON.stringify(record), 'NX');
    if (!ok) {
      throw new HttpError(409, 'An organizer password is already set. Sign in instead.', 'ALREADY_SETUP');
    }
    return { session: auth.makeSession(record) };
  },

  async login({ password }) {
    const [fails, adminText] = await db.pipeline([
      ['GET', KEYS.fails],
      ['GET', KEYS.admin],
    ]);
    const record = parse(adminText);
    if (!record) throw new HttpError(409, 'There is no organizer password yet.', 'NOT_SETUP');
    if (Number(fails || 0) >= 10) {
      throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes, then try again.', 'LOCKED');
    }
    if (!(await auth.checkPassword(String(password ?? ''), record))) {
      await db.pipeline([
        ['INCR', KEYS.fails],
        ['EXPIRE', KEYS.fails, 900],
      ]);
      throw new HttpError(401, "That password isn't right.", 'BAD_PASSWORD');
    }
    await db.cmd('DEL', KEYS.fails);
    return { session: auth.makeSession(record) };
  },

  // A participant opening their link. `reveal` is sent once they unfold their slip.
  async me({ token, reveal }) {
    const state = await load();
    const me = findByToken(state, token);
    if (!me) throw badLink();
    const wantsReveal = !!reveal && !!state.meta.drawnAt;
    if (wantsReveal && state.draw[me.id] && !state.seen[me.id]) {
      const now = String(Date.now());
      await db.cmd('HSET', KEYS.seen, me.id, now);
      state.seen[me.id] = now;
    }
    return participantView(state, me, { reveal: wantsReveal });
  },

  // A participant saving their own gift list.
  async saveList({ token, link, notes }) {
    const state = await load();
    const me = findByToken(state, token);
    if (!me) throw badLink();
    const entry = { link: cleanLink(link), notes: cleanNotes(notes), updatedAt: Date.now() };
    await db.cmd('HSET', KEYS.lists, me.id, JSON.stringify(entry));
    return { me: { name: me.name, link: entry.link, notes: entry.notes, listUpdatedAt: entry.updatedAt } };
  },
};

// ---------- organizer actions (need a signed-in session) ----------

function notWhileDrawn(state, message) {
  if (state.meta.drawnAt) throw new HttpError(409, message, 'DRAWN');
}

const adminActions = {
  async state() {},

  async addPeople(state, { names }) {
    notWhileDrawn(state, 'Names are already drawn. Undo the draw to add people.');
    const raw = Array.isArray(names) ? names : String(names ?? '').split(/[\n,]/);
    const clean = raw.map(oneLine).filter(Boolean).map(cleanName);
    if (!clean.length) throw new HttpError(400, 'Type at least one name.');
    const taken = new Set(state.people.map((p) => p.name.toLowerCase()));
    for (const name of clean) {
      const key = name.toLowerCase();
      if (taken.has(key)) {
        throw new HttpError(
          409,
          `${name} is already in the exchange. Add a last initial to tell them apart.`,
          'DUPLICATE'
        );
      }
      taken.add(key);
    }
    if (state.people.length + clean.length > LIMITS.people) {
      throw new HttpError(400, `The exchange can hold up to ${LIMITS.people} people.`);
    }
    const now = Date.now();
    const fields = [];
    clean.forEach((name, i) => {
      const person = { id: auth.newId(), name, token: auth.newLinkToken(), createdAt: now + i };
      fields.push(person.id, JSON.stringify(person));
    });
    await db.cmd('HSET', KEYS.people, ...fields);
  },

  async updatePerson(state, { id, name, link, notes }) {
    const person = findPerson(state, id);
    const commands = [];
    if (name !== undefined) {
      const n = cleanName(name);
      const clash = state.people.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase());
      if (clash) {
        throw new HttpError(409, `${n} is already in the exchange. Add a last initial to tell them apart.`, 'DUPLICATE');
      }
      if (n !== person.name) commands.push(['HSET', KEYS.people, id, JSON.stringify({ ...person, name: n })]);
    }
    if (link !== undefined || notes !== undefined) {
      const current = listOf(state, id);
      const entry = {
        link: link !== undefined ? cleanLink(link) : current.link,
        notes: notes !== undefined ? cleanNotes(notes) : current.notes,
        updatedAt: Date.now(),
      };
      if (entry.link !== current.link || entry.notes !== current.notes) {
        commands.push(['HSET', KEYS.lists, id, JSON.stringify(entry)]);
      }
    }
    if (commands.length) await db.transaction(commands);
  },

  // Replace someone's private link (e.g. it was sent to the wrong person).
  async newLink(state, { id }) {
    const person = findPerson(state, id);
    await db.cmd('HSET', KEYS.people, id, JSON.stringify({ ...person, token: auth.newLinkToken() }));
  },

  async removePerson(state, { id }) {
    notWhileDrawn(state, 'Undo the draw before removing people.');
    findPerson(state, id);
    const pairs = state.meta.pairs.filter(([a, b]) => a !== id && b !== id);
    await db.transaction([
      ['HDEL', KEYS.people, id],
      ['HDEL', KEYS.lists, id],
      ['HDEL', KEYS.seen, id],
      saveMeta({ ...state.meta, pairs }),
    ]);
  },

  async saveSettings(state, { title, guidelines }) {
    const meta = { ...state.meta };
    if (title !== undefined) meta.title = cleanTitle(title);
    if (guidelines !== undefined) meta.guidelines = cleanGuidelines(guidelines);
    await db.cmd(...saveMeta(meta));
  },

  async setPairs(state, { pairs }) {
    notWhileDrawn(state, 'Undo the draw to change who is kept apart.');
    const ids = new Set(state.people.map((p) => p.id));
    const seen = new Set();
    const out = [];
    for (const pair of Array.isArray(pairs) ? pairs : []) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new HttpError(400, 'Each pair needs two people.');
      const [a, b] = pair.map(String);
      if (a === b) throw new HttpError(400, 'Pick two different people.');
      if (!ids.has(a) || !ids.has(b)) {
        throw new HttpError(400, 'One of those people is no longer in the exchange.');
      }
      const key = [a, b].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
    await db.cmd(...saveMeta({ ...state.meta, pairs: out }));
  },

  async draw(state) {
    notWhileDrawn(state, 'Names are already drawn.');
    const ids = state.people.map((p) => p.id);
    const known = new Set(ids);
    const pairs = state.meta.pairs.filter(([a, b]) => known.has(a) && known.has(b));
    let matches;
    try {
      matches = makeDraw(ids, pairs);
    } catch (err) {
      if (err instanceof DrawError) throw new HttpError(400, err.message, 'DRAW_FAILED');
      throw err;
    }
    await db.transaction([
      ['DEL', KEYS.draw],
      ['HSET', KEYS.draw, ...Object.entries(matches).flat()],
      ['DEL', KEYS.seen],
      saveMeta({ ...state.meta, pairs, drawnAt: Date.now(), revealedAt: null }),
    ]);
  },

  async undoDraw(state) {
    await db.transaction([
      ['DEL', KEYS.draw],
      ['DEL', KEYS.seen],
      saveMeta({ ...state.meta, drawnAt: null, revealedAt: null }),
    ]);
  },

  async setReveal(state, { on }) {
    if (!state.meta.drawnAt) throw new HttpError(409, 'Draw names before revealing.', 'NOT_DRAWN');
    await db.cmd(...saveMeta({ ...state.meta, revealedAt: on ? Date.now() : null }));
  },
};

// ---------- entry point ----------

export async function handle(request) {
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400);
  const action = typeof body.action === 'string' ? body.action : '';

  try {
    if (!db.redisConfig()) {
      if (action === 'status') return json({ db: false, setup: false });
      return json({ error: "The site's database isn't connected yet.", code: 'NO_DB' }, 503);
    }

    if (Object.hasOwn(publicActions, action)) {
      return json(await publicActions[action](body));
    }

    if (Object.hasOwn(adminActions, action)) {
      const state = await load({ withAdmin: true });
      const auth_ = request.headers.get('authorization') || '';
      const session = auth_.replace(/^Bearer\s+/i, '');
      if (!state.admin || !auth.checkSession(session, state.admin)) {
        throw new HttpError(401, 'Your sign-in expired. Sign in again.', 'AUTH');
      }
      await adminActions[action](state, body);
      return json(adminView(action === 'state' ? state : await load()));
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
    console.error(err);
    if (err instanceof db.DbError) {
      return json({ error: "Couldn't reach the database. Try again in a moment.", code: 'DB' }, 503);
    }
    return json({ error: 'Something went wrong on the server. Try again in a moment.', code: 'SERVER' }, 500);
  }
}
