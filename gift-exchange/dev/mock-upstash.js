// In-memory stand-in for Upstash's REST API, for local development only.
// Supports the handful of commands the site uses, with the same request and
// response shapes: POST / (one command), /pipeline and /multi-exec.
import http from 'node:http';

export function startMockUpstash({ port = 0, token = 'dev-token' } = {}) {
  const strings = new Map();
  const hashes = new Map();
  const expiry = new Map();

  const purge = () => {
    const now = Date.now();
    for (const [k, t] of expiry) {
      if (t <= now) {
        strings.delete(k);
        hashes.delete(k);
        expiry.delete(k);
      }
    }
  };

  const exec = (command) => {
    if (!Array.isArray(command) || !command.length) throw new Error('ERR empty command');
    purge();
    const [rawName, ...args] = command;
    const name = String(rawName).toUpperCase();
    const k = args[0] === undefined ? undefined : String(args[0]);
    switch (name) {
      case 'GET':
        if (hashes.has(k)) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
        return strings.has(k) ? strings.get(k) : null;
      case 'SET': {
        const opts = args.slice(2).map((o) => String(o).toUpperCase());
        if (opts.includes('NX') && (strings.has(k) || hashes.has(k))) return null;
        strings.set(k, String(args[1]));
        hashes.delete(k);
        const ex = opts.indexOf('EX');
        if (ex >= 0) expiry.set(k, Date.now() + Number(args[2 + ex + 1]) * 1000);
        else expiry.delete(k);
        return 'OK';
      }
      case 'DEL': {
        let n = 0;
        for (const key of args.map(String)) {
          if (strings.delete(key)) n++;
          if (hashes.delete(key)) n++;
          expiry.delete(key);
        }
        return n;
      }
      case 'INCR': {
        if (hashes.has(k)) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
        const v = Number(strings.get(k) ?? 0);
        if (!Number.isInteger(v)) throw new Error('ERR value is not an integer or out of range');
        strings.set(k, String(v + 1));
        return v + 1;
      }
      case 'EXPIRE':
        if (!strings.has(k) && !hashes.has(k)) return 0;
        expiry.set(k, Date.now() + Number(args[1]) * 1000);
        return 1;
      case 'HSET': {
        const fv = args.slice(1);
        if (!fv.length || fv.length % 2) throw new Error("ERR wrong number of arguments for 'hset' command");
        if (strings.has(k)) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
        let h = hashes.get(k);
        if (!h) hashes.set(k, (h = new Map()));
        let added = 0;
        for (let i = 0; i < fv.length; i += 2) {
          if (!h.has(String(fv[i]))) added++;
          h.set(String(fv[i]), String(fv[i + 1]));
        }
        return added;
      }
      case 'HGET':
        return hashes.get(k)?.get(String(args[1])) ?? null;
      case 'HDEL': {
        const h = hashes.get(k);
        if (!h) return 0;
        let n = 0;
        for (const f of args.slice(1).map(String)) if (h.delete(f)) n++;
        if (!h.size) hashes.delete(k);
        return n;
      }
      case 'HGETALL': {
        const h = hashes.get(k);
        if (!h) return [];
        const out = [];
        for (const [f, v] of h) out.push(f, v);
        return out;
      }
      case 'KEYS':
        return [...strings.keys(), ...hashes.keys()];
      case 'FLUSHALL':
        strings.clear();
        hashes.clear();
        expiry.clear();
        return 'OK';
      default:
        throw new Error(`ERR unknown command '${name}'`);
    }
  };

  const run = (command) => {
    try {
      return { result: exec(command) };
    } catch (err) {
      return { error: err.message };
    }
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'WRONGPASS invalid password' });
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return send(400, { error: 'ERR failed to parse command' });
      }
      const path = req.url.replace(/\/+$/, '');
      if (path === '' || path === '/') {
        const out = run(parsed);
        return send(out.error ? 400 : 200, out);
      }
      if (path === '/pipeline' || path === '/multi-exec') {
        if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) return send(400, { error: 'ERR bad pipeline' });
        return send(200, parsed.map(run));
      }
      send(404, { error: 'not found' });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ url: `http://127.0.0.1:${actual}`, token, server, exec });
    });
  });
}
