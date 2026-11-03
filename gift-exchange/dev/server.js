// Local preview: `npm run dev`, then open http://localhost:3000/admin
// Uses an in-memory database unless real Upstash credentials are in the env.
// Mirrors Vercel's behavior for this project: static files from public/,
// clean URLs (/admin -> admin.html), headers from vercel.json, and the
// function in api/exchange.js.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startMockUpstash } from './mock-upstash.js';
import { redisConfig } from '../lib/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

export async function startDevServer({ port = Number(process.env.PORT) || 3000, quiet = false } = {}) {
  let mock = null;
  if (!redisConfig()) {
    mock = await startMockUpstash();
    process.env.KV_REST_API_URL = mock.url;
    process.env.KV_REST_API_TOKEN = mock.token;
  }
  const { default: fn } = await import('../api/exchange.js');
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  const headerRules = (config.headers || []).map((rule) => ({
    re: new RegExp('^' + rule.source.replace(/\(\.\*\)/g, '.*') + '$'),
    headers: rule.headers,
  }));
  const applyHeaders = (pathname, res) => {
    for (const rule of headerRules) {
      if (rule.re.test(pathname)) for (const h of rule.headers) res.setHeader(h.key, h.value);
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    applyHeaders(pathname, res);

    if (pathname === '/api/exchange') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await fn.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    // cleanUrls: /admin.html -> 308 /admin, /admin -> admin.html
    if (pathname.endsWith('.html')) {
      res.writeHead(308, { Location: pathname.replace(/(index)?\.html$/, '') || '/' });
      return res.end();
    }
    let file = pathname === '/' ? '/index.html' : pathname;
    if (!path.extname(file)) file += '.html';
    const full = path.join(publicDir, path.normalize(file));
    if (!full.startsWith(publicDir)) {
      res.writeHead(403);
      return res.end();
    }
    try {
      const data = await readFile(full);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = `http://localhost:${server.address().port}`;
  if (!quiet) {
    console.log(`Gift exchange running at ${address}`);
    console.log(`Organizer page: ${address}/admin`);
    if (mock) console.log('Using a temporary in-memory database (cleared when you stop this).');
  }
  return { server, address, mock };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startDevServer();
}
