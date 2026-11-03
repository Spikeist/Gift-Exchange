// Demo mode: the same actions as the real server, run in the visitor's
// browser with pretend data kept in localStorage. Nothing is sent anywhere,
// so the real exchange is never touched.
import { ApiError } from './common.js';

const KEY = 'gx-demo-state';
const DEFAULT_GUIDELINES = [
  "Don't tell anyone the name you got.",
  'Spend $100–150 minimum on the person.',
  'Bring the gift(s) wrapped in one box or bag if possible, two at the most.',
  'The reveal will happen at the end, when all the gifts have been opened.',
];

let memory = null; // used if localStorage is unavailable

function blank() {
  return {
    meta: {
      title: 'Gift Exchange (demo)',
      guidelines: DEFAULT_GUIDELINES,
      pairs: [],
      drawnAt: null,
      revealedAt: null,
      joinCode: null,
      joinOpen: true,
    },
    people: [],
    lists: {},
    draw: {},
    seen: {},
  };
}

function load() {
  try {
    const text = localStorage.getItem(KEY);
    if (text) return JSON.parse(text);
  } catch {
    if (memory) return structuredClone(memory);
  }
  return memory ? structuredClone(memory) : blank();
}

function save(state) {
  memory = structuredClone(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* in-memory only */
  }
}

export function resetDemo() {
  memory = null;
  try {
    localStorage.removeItem(KEY);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('gx-demo-open-') || k.startsWith('gx-demo-joined-'))) localStorage.removeItem(k);
    }
  } catch {
    /* nothing stored */
  }
}

const fail = (status, message, code) => {
  throw new ApiError(message, status, code);
};

function randomToken(bytes = 16) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randInt(min, max) {
  const range = max - min;
  const limit = Math.floor(0x100000000 / range) * range;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return min + (buf[0] % range);
}

// ---------- same rules as the server ----------

const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function cleanName(v) {
  const s = oneLine(v);
  if (!s) fail(400, 'Enter a name.');
  if (s.length > 60) fail(400, 'Keep names under 60 characters.');
  return s;
}

const NOT_A_LINK =
  "That doesn't look like a web link. Copy the full address from your browser or the list's Share button.";

function cleanLink(v) {
  let s = String(v ?? '').trim();
  if (!s) return '';
  if (s.length > 2000) fail(400, 'That link is too long.');
  const found = s.match(/https?:\/\/[^\s<>"']+/i);
  if (found) s = found[0].replace(/[.,;:!?]+$/, '');
  else if (/\s/.test(s)) fail(400, NOT_A_LINK);
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let url;
  try {
    url = new URL(s);
  } catch {
    fail(400, NOT_A_LINK);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) fail(400, NOT_A_LINK);
  return url.toString();
}

function cleanNotes(v) {
  const s = String(v ?? '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (s.length > 2000) fail(400, 'Keep notes under 2000 characters.');
  return s;
}

function makeDraw(ids, pairs) {
  if (ids.length < 3) fail(400, 'Add at least 3 people before drawing names.', 'DRAW_FAILED');
  const blocked = new Set(pairs.flatMap(([a, b]) => [a + '|' + b, b + '|' + a]));
  const ok = (g, r) => g !== r && !blocked.has(g + '|' + r);
  const shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = randInt(0, i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  for (let t = 0; t < 20000; t++) {
    const r = shuffle(ids.slice());
    if (ids.every((g, i) => ok(g, r[i]))) return Object.fromEntries(ids.map((g, i) => [g, r[i]]));
  }
  // tight rules: search directly
  const used = new Set();
  const out = {};
  const go = (k) => {
    if (k === ids.length) return true;
    for (const r of shuffle(ids.filter((x) => ok(ids[k], x)))) {
      if (used.has(r)) continue;
      used.add(r);
      out[ids[k]] = r;
      if (go(k + 1)) return true;
      used.delete(r);
    }
    return false;
  };
  if (!go(0)) fail(400, 'No draw is possible with the current keep-apart pairs. Remove a pair and try again.', 'DRAW_FAILED');
  return out;
}

function listOf(s, id) {
  const l = s.lists[id] || {};
  return { link: l.link || '', notes: l.notes || '', listUpdatedAt: l.updatedAt || null };
}

function revealRows(s) {
  const byId = Object.fromEntries(s.people.map((p) => [p.id, p]));
  const visited = new Set();
  const rows = [];
  let loop = 0;
  for (const p of s.people) {
    if (visited.has(p.id) || !s.draw[p.id]) continue;
    loop += 1;
    let cur = p.id;
    while (!visited.has(cur) && s.draw[cur]) {
      visited.add(cur);
      rows.push({ giver: byId[cur]?.name || 'Someone', receiver: byId[s.draw[cur]]?.name || 'Someone', loop });
      cur = s.draw[cur];
    }
  }
  return rows;
}

function adminView(s) {
  const drawn = !!s.meta.drawnAt;
  return {
    ...s.meta,
    siteUrl: null,
    people: s.people.map((p) => ({
      id: p.id,
      name: p.name,
      token: p.token,
      ...listOf(s, p.id),
      openedAt: drawn && s.seen[p.id] ? s.seen[p.id] : null,
    })),
    reveal: s.meta.revealedAt ? revealRows(s) : null,
  };
}

function participantView(s, me, reveal) {
  const drawn = !!s.meta.drawnAt;
  const revealed = !!s.meta.revealedAt;
  const view = {
    title: s.meta.title,
    guidelines: s.meta.guidelines,
    me: { name: me.name, ...listOf(s, me.id) },
    peopleCount: s.people.length,
    drawn,
    revealed,
    inDraw: drawn ? !!s.draw[me.id] : null,
    recipient: null,
    reveal: null,
  };
  if (drawn && (reveal || revealed)) {
    const r = s.people.find((p) => p.id === s.draw[me.id]);
    if (r) view.recipient = { name: r.name, ...listOf(s, r.id) };
  }
  if (revealed) view.reveal = revealRows(s);
  return view;
}

const findPerson = (s, id) => s.people.find((p) => p.id === id) || fail(404, 'That person is no longer in the exchange.');
const findByToken = (s, token) =>
  s.people.find((p) => p.token === token) ||
  fail(404, "This link doesn't work anymore. Ask the organizer to send you your current link.", 'BAD_LINK');
const notWhileDrawn = (s, msg) => s.meta.drawnAt && fail(409, msg, 'DRAWN');

function addNames(s, names) {
  const clean = names.map(oneLine).filter(Boolean).map(cleanName);
  if (!clean.length) fail(400, 'Type at least one name.');
  const taken = new Set(s.people.map((p) => p.name.toLowerCase()));
  for (const name of clean) {
    if (taken.has(name.toLowerCase())) {
      fail(409, `${name} is already in the exchange. Add a last initial to tell them apart.`, 'DUPLICATE');
    }
    taken.add(name.toLowerCase());
  }
  if (s.people.length + clean.length > 100) fail(400, 'The exchange can hold up to 100 people.');
  const now = Date.now();
  clean.forEach((name, i) => s.people.push({ id: randomToken(6), name, token: randomToken(), createdAt: now + i }));
}

const SAMPLE = [
  ['Alex', 'https://www.example.com/alex-wish-list', 'Size L hoodies. Into golf and good coffee.'],
  ['Jordan', 'https://www.example.com/jordan-wish-list', ''],
  ['Sam', '', 'No list yet. Likes cooking, candles, and anything cozy.'],
  ['Taylor', 'https://www.example.com/taylor-wish-list', 'Shoe size 9.'],
  ['Morgan', '', ''],
  ['Casey', 'https://www.example.com/casey-wish-list', 'Big reader. Fantasy and mystery.'],
];

const admin = {
  state() {},
  setJoin(s, { open }) {
    s.meta.joinOpen = !!open;
  },
  newJoinCode(s) {
    s.meta.joinCode = randomToken();
  },
  addSample(s) {
    notWhileDrawn(s, 'Names are already drawn. Undo the draw to add people.');
    const have = new Set(s.people.map((p) => p.name.toLowerCase()));
    const fresh = SAMPLE.filter(([n]) => !have.has(n.toLowerCase()));
    if (!fresh.length) fail(409, 'The sample people are already in.');
    addNames(s, fresh.map(([n]) => n));
    for (const [name, link, notes] of fresh) {
      const p = s.people.find((x) => x.name === name);
      if (link || notes) s.lists[p.id] = { link, notes, updatedAt: Date.now() };
    }
  },
  addPeople(s, { names }) {
    notWhileDrawn(s, 'Names are already drawn. Undo the draw to add people.');
    addNames(s, Array.isArray(names) ? names : String(names ?? '').split(/[\n,]/));
  },
  updatePerson(s, { id, name, link, notes }) {
    const p = findPerson(s, id);
    if (name !== undefined) {
      const n = cleanName(name);
      if (s.people.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) {
        fail(409, `${n} is already in the exchange. Add a last initial to tell them apart.`, 'DUPLICATE');
      }
      p.name = n;
    }
    const cur = listOf(s, id);
    const next = {
      link: link !== undefined ? cleanLink(link) : cur.link,
      notes: notes !== undefined ? cleanNotes(notes) : cur.notes,
    };
    if (next.link !== cur.link || next.notes !== cur.notes) s.lists[id] = { ...next, updatedAt: Date.now() };
  },
  newLink(s, { id }) {
    findPerson(s, id).token = randomToken();
  },
  removePerson(s, { id }) {
    notWhileDrawn(s, 'Undo the draw before removing people.');
    findPerson(s, id);
    s.people = s.people.filter((p) => p.id !== id);
    delete s.lists[id];
    delete s.seen[id];
    s.meta.pairs = s.meta.pairs.filter(([a, b]) => a !== id && b !== id);
  },
  saveSettings(s, { title, guidelines }) {
    if (title !== undefined) {
      const t = oneLine(title);
      if (t.length > 80) fail(400, 'Keep the name under 80 characters.');
      s.meta.title = t || 'Gift Exchange (demo)';
    }
    if (guidelines !== undefined) {
      const list = (Array.isArray(guidelines) ? guidelines : String(guidelines).split('\n')).map(oneLine).filter(Boolean);
      if (list.length > 12) fail(400, 'Keep it to 12 guidelines or fewer.');
      if (list.some((g) => g.length > 300)) fail(400, 'Keep each guideline under 300 characters.');
      s.meta.guidelines = list;
    }
  },
  setPairs(s, { pairs }) {
    notWhileDrawn(s, 'Undo the draw to change who is kept apart.');
    const ids = new Set(s.people.map((p) => p.id));
    const seen = new Set();
    const out = [];
    for (const pair of pairs || []) {
      const [a, b] = pair.map(String);
      if (a === b) fail(400, 'Pick two different people.');
      if (!ids.has(a) || !ids.has(b)) fail(400, 'One of those people is no longer in the exchange.');
      const key = [a, b].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        out.push([a, b]);
      }
    }
    s.meta.pairs = out;
  },
  draw(s) {
    notWhileDrawn(s, 'Names are already drawn.');
    s.draw = makeDraw(s.people.map((p) => p.id), s.meta.pairs);
    s.seen = {};
    s.meta.drawnAt = Date.now();
    s.meta.revealedAt = null;
  },
  undoDraw(s) {
    s.draw = {};
    s.seen = {};
    s.meta.drawnAt = null;
    s.meta.revealedAt = null;
  },
  setReveal(s, { on }) {
    if (!s.meta.drawnAt) fail(409, 'Draw names before revealing.', 'NOT_DRAWN');
    s.meta.revealedAt = on ? Date.now() : null;
  },
};

export async function handle(action, data = {}) {
  const s = load();
  if (!s.meta.joinCode) {
    s.meta.joinCode = randomToken();
    if (s.meta.joinOpen === undefined) s.meta.joinOpen = true;
    save(s);
  }
  const checkJoin = () => data.code === s.meta.joinCode || fail(404, "This join link doesn't work anymore. Ask the organizer for the current one.", 'BAD_JOIN');
  if (action === 'joinInfo') {
    checkJoin();
    return { title: s.meta.title, open: s.meta.joinOpen && !s.meta.drawnAt, drawn: !!s.meta.drawnAt, peopleCount: s.people.length };
  }
  if (action === 'join') {
    checkJoin();
    if (s.meta.drawnAt) fail(409, 'Names have already been drawn, so joining is closed. Ask the organizer to add you.', 'JOIN_CLOSED');
    if (!s.meta.joinOpen) fail(409, 'The organizer has closed joining. Ask them to add you.', 'JOIN_CLOSED');
    const n = cleanName(data.name);
    if (s.people.some((p) => p.name.toLowerCase() === n.toLowerCase())) {
      fail(409, `Someone named ${n} has already joined. If that's you, ask the organizer for your link. Otherwise add your last initial.`, 'DUPLICATE');
    }
    const entry = { link: cleanLink(data.link), notes: cleanNotes(data.notes), updatedAt: Date.now() };
    const person = { id: randomToken(6), name: n, token: randomToken(), createdAt: Date.now() };
    s.people.push(person);
    if (entry.link || entry.notes) s.lists[person.id] = entry;
    save(s);
    return { token: person.token, name: person.name };
  }
  if (action === 'status') return { db: true, setup: true };
  if (action === 'login' || action === 'setup') return { session: 'demo' };
  if (action === 'me') {
    const me = findByToken(s, data.token);
    const wants = !!data.reveal && !!s.meta.drawnAt;
    if (wants && s.draw[me.id] && !s.seen[me.id]) {
      s.seen[me.id] = Date.now();
      save(s);
    }
    return participantView(s, me, wants);
  }
  if (action === 'saveList') {
    const me = findByToken(s, data.token);
    const entry = { link: cleanLink(data.link), notes: cleanNotes(data.notes), updatedAt: Date.now() };
    s.lists[me.id] = entry;
    save(s);
    return { me: { name: me.name, link: entry.link, notes: entry.notes, listUpdatedAt: entry.updatedAt } };
  }
  if (action === 'demoPeople') {
    return { title: s.meta.title, people: s.people.map((p) => ({ name: p.name, token: p.token })) };
  }
  if (Object.hasOwn(admin, action)) {
    admin[action](s, data);
    save(s);
    return adminView(s);
  }
  fail(400, 'Unknown action');
}
