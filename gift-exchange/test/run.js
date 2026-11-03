// End-to-end checks against the local dev server and its in-memory database.
// Run with: npm test
import assert from 'node:assert/strict';
import { startDevServer } from '../dev/server.js';
import { makeDraw, revealOrder, DrawError } from '../lib/draw.js';
import { redisConfig } from '../lib/store.js';

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
};

// ---------- draw algorithm ----------

await test('draws are valid and every outcome is equally likely', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const counts = new Map();
  const runs = 90000;
  for (let i = 0; i < runs; i++) {
    const d = makeDraw(ids);
    assert.deepEqual(Object.keys(d).sort(), ids);
    assert.deepEqual(Object.values(d).sort(), ids);
    for (const g of ids) assert.notEqual(d[g], g);
    const key = ids.map((g) => d[g]).join('');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.equal(counts.size, 9); // 4 people have exactly 9 valid draws
  const values = [...counts.values()];
  assert.ok(Math.max(...values) / Math.min(...values) < 1.12, JSON.stringify([...counts]));
});

await test('keep-apart pairs are honored in both directions', () => {
  const ids = Array.from({ length: 8 }, (_, i) => 'p' + i);
  const pairs = [['p0', 'p1'], ['p2', 'p3'], ['p4', 'p5']];
  for (let i = 0; i < 5000; i++) {
    const d = makeDraw(ids, pairs);
    for (const g of ids) assert.notEqual(d[g], g);
    for (const [a, b] of pairs) {
      assert.notEqual(d[a], b);
      assert.notEqual(d[b], a);
    }
    assert.equal(new Set(Object.values(d)).size, ids.length);
  }
});

await test('impossible rules are reported, tight-but-possible rules still draw', () => {
  assert.throws(() => makeDraw(['a', 'b']), DrawError);
  assert.throws(() => makeDraw(['a', 'b', 'c'], [['a', 'b']]), DrawError);
  // a can only give to d, c can only give to b
  const pairs = [['a', 'b'], ['c', 'd'], ['a', 'c']];
  for (let i = 0; i < 200; i++) {
    const d = makeDraw(['a', 'b', 'c', 'd'], pairs);
    assert.equal(d.a, 'd');
    assert.equal(d.c, 'b');
  }
  // Everyone kept apart from everyone but one person: only a cycle through them works.
  const many = Array.from({ length: 30 }, (_, i) => 'x' + i);
  const d = makeDraw(many, []);
  assert.equal(Object.keys(d).length, 30);
});

await test('reveal order follows each loop', () => {
  const people = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const rows = revealOrder(people, { a: 'b', b: 'c', c: 'a', d: 'e', e: 'd' });
  assert.deepEqual(
    rows.map((r) => `${r.giverId}>${r.receiverId}:${r.loop}`),
    ['a>b:1', 'b>c:1', 'c>a:1', 'd>e:2', 'e>d:2']
  );
});

await test('finds the database settings under any prefix Vercel uses', () => {
  const cfg = (env) => redisConfig(env);
  assert.deepEqual(cfg({ KV_REST_API_URL: 'u1', KV_REST_API_TOKEN: 't1' }), { url: 'u1', token: 't1' });
  assert.deepEqual(cfg({ UPSTASH_REDIS_REST_URL: 'u2', UPSTASH_REDIS_REST_TOKEN: 't2' }), { url: 'u2', token: 't2' });
  assert.deepEqual(
    cfg({ STORAGE_KV_REST_API_URL: 'u3', STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'ro', STORAGE_KV_REST_API_TOKEN: 't3' }),
    { url: 'u3', token: 't3' }
  );
  assert.deepEqual(cfg({ GIFTS_REDIS_REST_URL: 'u4', GIFTS_REDIS_REST_TOKEN: 't4' }), { url: 'u4', token: 't4' });
  assert.equal(cfg({ KV_REST_API_URL: 'u5' }), null);
  assert.equal(cfg({}), null);
});

// ---------- API through the dev server ----------

const { server, address, mock } = await startDevServer({ port: 0, quiet: true });
const call = async (action, data = {}, session) => {
  const res = await fetch(`${address}/api/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
    },
    body: JSON.stringify({ action, ...data }),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
};

try {
  let session;

  await test('first visit asks for setup', async () => {
    const r = await call('status');
    assert.deepEqual(r.body, { db: true, setup: false });
    assert.equal((await call('login', { password: 'whatever' })).status, 409);
    assert.equal((await call('state')).status, 401);
  });

  await test('organizer password setup and sign-in', async () => {
    assert.equal((await call('setup', { password: '123' })).status, 400);
    const r = await call('setup', { password: 'holly-jolly' });
    assert.equal(r.status, 200);
    session = r.body.session;
    assert.ok(session);
    assert.equal((await call('setup', { password: 'other-pass' })).status, 409);
    assert.equal((await call('login', { password: 'nope-nope' })).status, 401);
    const ok = await call('login', { password: 'holly-jolly' });
    assert.equal(ok.status, 200);
    assert.equal((await call('state', {}, 'garbage.token')).status, 401);
    assert.equal((await call('state', {}, '9999999999999.' + 'A'.repeat(43))).status, 401);
    const st = await call('state', {}, ok.body.session);
    assert.equal(st.status, 200);
    assert.equal(st.body.title, 'Gift Exchange');
    assert.equal(st.body.guidelines.length, 4);
    assert.deepEqual(st.body.people, []);
    assert.equal(st.headers.get('cache-control'), 'no-store');
  });

  let state;
  await test('adding people', async () => {
    let r = await call('addPeople', { names: 'Alex, Jordan\nSam\n  \nTaylor' }, session);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.people.map((p) => p.name), ['Alex', 'Jordan', 'Sam', 'Taylor']);
    r = await call('addPeople', { names: ['alex'] }, session);
    assert.equal(r.status, 409);
    r = await call('addPeople', { names: ['Morgan', 'morgan'] }, session);
    assert.equal(r.status, 409);
    r = await call('addPeople', { names: ['   '] }, session);
    assert.equal(r.status, 400);
    r = await call('addPeople', { names: ['Casey <img src=x onerror=alert(1)>'] }, session);
    assert.equal(r.status, 200);
    state = r.body;
    assert.equal(state.people.length, 5);
    const tokens = new Set(state.people.map((p) => p.token));
    assert.equal(tokens.size, 5);
    for (const t of tokens) assert.match(t, /^[A-Za-z0-9_-]{22}$/);
  });

  await test('people can add themselves with the join link', async () => {
    const code = state.joinCode;
    assert.match(code, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(state.joinOpen, true);
    assert.equal((await call('joinInfo', { code: 'wrong-code-123456' })).status, 404);
    let r = await call('joinInfo', { code });
    assert.deepEqual(r.body, { title: 'Gift Exchange', open: true, drawn: false, peopleCount: 5 });
    r = await call('join', { code, name: 'Riley', link: 'amazon.com/hz/wishlist/ls/RILEY', notes: 'Size S' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const me = await call('me', { token: r.body.token });
    assert.equal(me.body.me.name, 'Riley');
    assert.equal(me.body.me.link, 'https://amazon.com/hz/wishlist/ls/RILEY');
    assert.equal((await call('join', { code, name: 'riley' })).status, 409);
    assert.equal((await call('join', { code: 'nope-nope-nope-1', name: 'Zed' })).status, 404);
    // organizer can close joining and replace the code
    r = await call('setJoin', { open: false }, session);
    assert.equal(r.body.joinOpen, false);
    assert.equal((await call('join', { code, name: 'Zed' })).status, 409);
    r = await call('setJoin', { open: true }, session);
    r = await call('newJoinCode', {}, session);
    assert.notEqual(r.body.joinCode, code);
    assert.equal((await call('joinInfo', { code })).status, 404);
    // clean up so later checks see the original five
    const riley = r.body.people.find((p) => p.name === 'Riley');
    r = await call('removePerson', { id: riley.id }, session);
    state = r.body;
    assert.equal(state.people.length, 5);
  });

  const byName = (name) => state.people.find((p) => p.name.startsWith(name));

  await test('participant page before the draw', async () => {
    const r = await call('me', { token: byName('Alex').token });
    assert.equal(r.status, 200);
    assert.equal(r.body.me.name, 'Alex');
    assert.equal(r.body.drawn, false);
    assert.equal(r.body.recipient, null);
    assert.equal(r.body.peopleCount, 5);
    assert.equal((await call('me', { token: 'not-a-real-token-123' })).status, 404);
    assert.equal((await call('me', {})).status, 404);
  });

  await test('participants save their own list, links get cleaned up', async () => {
    const t = byName('Jordan').token;
    let r = await call('saveList', { token: t, link: 'amazon.com/hz/wishlist/ls/ABC123', notes: 'Size M\r\nLikes coffee' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.me.link, 'https://amazon.com/hz/wishlist/ls/ABC123');
    assert.equal(r.body.me.notes, 'Size M\nLikes coffee');
    r = await call('saveList', { token: t, link: 'Check out my list on Amazon https://www.amazon.com/hz/wishlist/ls/XYZ?ref_=wl_share.', notes: '' });
    assert.equal(r.body.me.link, 'https://www.amazon.com/hz/wishlist/ls/XYZ?ref_=wl_share');
    for (const bad of ['javascript:alert(1)', 'not a link at all', 'ftp://example.com/x', 'localhost']) {
      r = await call('saveList', { token: t, link: bad, notes: '' });
      assert.equal(r.status, 400, bad);
    }
    r = await call('saveList', { token: t, link: '', notes: 'x'.repeat(2001) });
    assert.equal(r.status, 400);
    r = await call('saveList', { token: byName('Casey').token, link: 'https://target.com/gift-registry/abc', notes: '<script>alert(1)</script>' });
    assert.equal(r.status, 200);
    assert.equal(r.body.me.notes, '<script>alert(1)</script>'); // stored as text; pages render it as text
    r = await call('me', { token: t });
    assert.equal(r.body.me.link, 'https://www.amazon.com/hz/wishlist/ls/XYZ?ref_=wl_share');
  });

  await test('organizer can edit someone and settings', async () => {
    let r = await call('updatePerson', { id: byName('Sam').id, name: 'Sam R.', link: 'https://www.etsy.com/registry/xyz', notes: 'Loves hiking' }, session);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    state = r.body;
    assert.equal(byName('Sam').name, 'Sam R.');
    assert.equal(byName('Sam').link, 'https://www.etsy.com/registry/xyz');
    r = await call('updatePerson', { id: byName('Sam').id, name: 'alex' }, session);
    assert.equal(r.status, 409);
    r = await call('saveSettings', { title: '  Family Gift Exchange  ', guidelines: ['One', '  ', 'Two'] }, session);
    assert.equal(r.body.title, 'Family Gift Exchange');
    assert.deepEqual(r.body.guidelines, ['One', 'Two']);
    r = await call('saveSettings', { guidelines: Array(13).fill('x') }, session);
    assert.equal(r.status, 400);
  });

  await test('keep-apart pairs', async () => {
    const a = byName('Alex').id, j = byName('Jordan').id, s = byName('Sam').id;
    let r = await call('setPairs', { pairs: [[a, j], [j, a], [s, s]] }, session);
    assert.equal(r.status, 400);
    r = await call('setPairs', { pairs: [[a, j], [j, a]] }, session);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.pairs, [[a, j]]);
    r = await call('setPairs', { pairs: [[a, 'nobody']] }, session);
    assert.equal(r.status, 400);
    state = r.status === 200 ? r.body : (await call('state', {}, session)).body;
  });

  const collectMatches = async () => {
    const out = {};
    for (const p of state.people) {
      const r = await call('me', { token: p.token, reveal: true });
      assert.equal(r.status, 200);
      assert.equal(r.body.drawn, true);
      assert.ok(r.body.recipient, `no recipient for ${p.name}`);
      out[p.name] = r.body.recipient.name;
    }
    return out;
  };

  await test('drawing names keeps the matches hidden from the organizer', async () => {
    let r = await call('draw', {}, session);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    state = r.body;
    assert.ok(state.drawnAt);
    assert.equal(state.reveal, null);
    const text = JSON.stringify(state);
    assert.ok(!/receiver|recipient|draw"/i.test(text), 'organizer state must not include matches');
    assert.ok(state.people.every((p) => p.openedAt === null));
    // Already drawn
    assert.equal((await call('draw', {}, session)).status, 409);
    // Locked while drawn
    assert.equal((await call('addPeople', { names: ['Late Larry'] }, session)).status, 409);
    assert.equal((await call('join', { code: state.joinCode, name: 'Late Larry' })).status, 409);
    assert.equal((await call('joinInfo', { code: state.joinCode })).body.open, false);
    assert.equal((await call('removePerson', { id: byName('Alex').id }, session)).status, 409);
    assert.equal((await call('setPairs', { pairs: [] }, session)).status, 409);
  });

  await test('participants only see their match after unfolding', async () => {
    const alex = byName('Alex');
    let r = await call('me', { token: alex.token });
    assert.equal(r.body.drawn, true);
    assert.equal(r.body.inDraw, true);
    assert.equal(r.body.recipient, null);
    let st = (await call('state', {}, session)).body;
    assert.equal(st.people.find((p) => p.id === alex.id).openedAt, null);
    r = await call('me', { token: alex.token, reveal: true });
    assert.ok(r.body.recipient);
    assert.notEqual(r.body.recipient.name, 'Alex');
    assert.notEqual(r.body.recipient.name, 'Jordan'); // kept apart
    assert.equal(r.body.reveal, null);
    st = (await call('state', {}, session)).body;
    assert.ok(st.people.find((p) => p.id === alex.id).openedAt > 0);
  });

  await test('the matches form a complete, valid draw', async () => {
    const m = await collectMatches();
    const names = state.people.map((p) => p.name);
    assert.deepEqual(Object.keys(m).sort(), [...names].sort());
    assert.deepEqual(Object.values(m).sort(), [...names].sort());
    for (const n of names) assert.notEqual(m[n], n);
    assert.notEqual(m.Alex, 'Jordan');
    assert.notEqual(m.Jordan, 'Alex');
    // recipient's list shows up live
    const giverOfJordan = Object.keys(m).find((k) => m[k] === 'Jordan');
    const r = await call('me', { token: byName(giverOfJordan).token, reveal: true });
    assert.equal(r.body.recipient.link, 'https://www.amazon.com/hz/wishlist/ls/XYZ?ref_=wl_share');
  });

  await test('reveal shows everyone the full list', async () => {
    let r = await call('setReveal', { on: true }, session);
    assert.equal(r.status, 200);
    assert.equal(r.body.reveal.length, 5);
    const p = await call('me', { token: byName('Taylor').token });
    assert.equal(p.body.revealed, true);
    assert.equal(p.body.reveal.length, 5);
    assert.ok(p.body.recipient, 'recipient shows after the reveal even without unfolding');
    r = await call('setReveal', { on: false }, session);
    assert.equal(r.body.reveal, null);
    assert.equal((await call('me', { token: byName('Taylor').token })).body.reveal, null);
  });

  await test('undo draw resets matches and opened status', async () => {
    let r = await call('undoDraw', {}, session);
    assert.equal(r.status, 200);
    assert.equal(r.body.drawnAt, null);
    assert.ok(r.body.people.every((p) => p.openedAt === null));
    r = await call('me', { token: byName('Alex').token, reveal: true });
    assert.equal(r.body.drawn, false);
    assert.equal(r.body.recipient, null);
    assert.equal((await call('setReveal', { on: true }, session)).status, 409);
  });

  await test('repeated draws always respect the rules', async () => {
    const a = byName('Alex').id, j = byName('Jordan').id;
    for (let i = 0; i < 15; i++) {
      assert.equal((await call('draw', {}, session)).status, 200);
      const m = await collectMatches();
      for (const n of Object.keys(m)) assert.notEqual(m[n], n);
      assert.notEqual(m.Alex, 'Jordan');
      assert.notEqual(m.Jordan, 'Alex');
      assert.equal((await call('undoDraw', {}, session)).status, 200);
    }
    void a;
    void j;
  });

  await test('new link replaces the old one; removing people', async () => {
    const sam = byName('Sam');
    let r = await call('newLink', { id: sam.id }, session);
    const fresh = r.body.people.find((p) => p.id === sam.id).token;
    assert.notEqual(fresh, sam.token);
    assert.equal((await call('me', { token: sam.token })).status, 404);
    assert.equal((await call('me', { token: fresh })).status, 200);
    r = await call('removePerson', { id: byName('Alex').id }, session);
    assert.equal(r.status, 200);
    assert.equal(r.body.people.length, 4);
    assert.deepEqual(r.body.pairs, []); // Alex's pair went with them
    state = r.body;
  });

  await test('impossible keep-apart rules give a clear error', async () => {
    // 4 people; keep Jordan apart from everyone else -> Jordan can't give to anyone
    const j = byName('Jordan').id;
    const others = state.people.filter((p) => p.id !== j).map((p) => [j, p.id]);
    let r = await call('setPairs', { pairs: others }, session);
    assert.equal(r.status, 200);
    r = await call('draw', {}, session);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'DRAW_FAILED');
    assert.equal((await call('setPairs', { pairs: [] }, session)).status, 200);
  });

  await test('wrong passwords lock sign-in for a while', async () => {
    for (let i = 0; i < 10; i++) await call('login', { password: 'wrong-' + i });
    const r = await call('login', { password: 'holly-jolly' });
    assert.equal(r.status, 429);
    mock.exec(['DEL', 'gx:login-fails']);
    assert.equal((await call('login', { password: 'holly-jolly' })).status, 200);
  });

  await test('bad requests', async () => {
    const res = await fetch(`${address}/api/exchange`, { method: 'POST', body: '{nope' });
    assert.equal(res.status, 400);
    assert.equal((await fetch(`${address}/api/exchange`)).status, 404);
    assert.equal((await call('dropTables')).status, 400);
    assert.equal((await call('__proto__')).status, 400);
    assert.equal((await call('constructor')).status, 400);
  });

  await test('a site without a database says so instead of crashing', async () => {
    const { handle } = await import('../lib/handler.js');
    const saved = { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    try {
      const req = (action) =>
        new Request('http://x/api/exchange', { method: 'POST', body: JSON.stringify({ action }), headers: { 'Content-Type': 'application/json' } });
      let r = await handle(req('status'));
      assert.deepEqual(await r.json(), { db: false, setup: false });
      r = await handle(req('me'));
      assert.equal(r.status, 503);
      assert.equal((await r.json()).code, 'NO_DB');
    } finally {
      process.env.KV_REST_API_URL = saved.url;
      process.env.KV_REST_API_TOKEN = saved.token;
    }
  });

  await test('pages are served with security headers', async () => {
    const res = await fetch(`${address}/admin`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    const home = await fetch(`${address}/`);
    assert.equal(home.status, 200);
  });

  console.log(`All ${passed} checks passed.`);
} finally {
  server.close();
  mock?.server.close();
}
