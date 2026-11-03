// Tiny client for Upstash Redis over its REST API (no npm packages needed).
// Vercel adds the URL and token as environment variables when you connect
// an Upstash Redis database to the project. The names depend on the prefix
// chosen while connecting, so this looks for any of the usual patterns.

export function redisConfig(env = process.env) {
  const pairs = [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ];
  for (const [u, t] of pairs) {
    if (env[u] && env[t]) return { url: env[u], token: env[t] };
  }
  // Custom prefixes, e.g. STORAGE_KV_REST_API_URL or GIFTS_REDIS_REST_URL
  for (const key of Object.keys(env)) {
    let m = key.match(/^(.*)REST_API_URL$/);
    if (m && env[key] && env[m[1] + 'REST_API_TOKEN']) {
      return { url: env[key], token: env[m[1] + 'REST_API_TOKEN'] };
    }
    m = key.match(/^(.*)REDIS_REST_URL$/);
    if (m && env[key] && env[m[1] + 'REDIS_REST_TOKEN']) {
      return { url: env[key], token: env[m[1] + 'REDIS_REST_TOKEN'] };
    }
  }
  return null;
}

export class DbError extends Error {}

async function post(path, body) {
  const cfg = redisConfig();
  if (!cfg) throw new DbError('Database not connected');
  const base = cfg.url.replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(base + path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new DbError('Could not reach the database: ' + err.message);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new DbError(`Database returned HTTP ${res.status}`);
  }
  if (!res.ok && !Array.isArray(data)) {
    throw new DbError('Database error: ' + ((data && data.error) || res.status));
  }
  return data;
}

function unwrap(list) {
  if (!Array.isArray(list)) {
    throw new DbError('Database error: ' + ((list && list.error) || 'unexpected response'));
  }
  return list.map((item) => {
    if (item && item.error) throw new DbError('Database error: ' + item.error);
    return item ? item.result : null;
  });
}

// One command: cmd('GET', 'key')
export async function cmd(...args) {
  const data = await post('', args);
  if (data && data.error) throw new DbError('Database error: ' + data.error);
  return data ? data.result : null;
}

// Several commands in one round trip (not atomic).
export async function pipeline(commands) {
  return unwrap(await post('/pipeline', commands));
}

// Several commands as one atomic transaction.
export async function transaction(commands) {
  return unwrap(await post('/multi-exec', commands));
}

// HGETALL comes back as a flat [field, value, field, value] list.
export function hashToObject(result) {
  const out = {};
  if (Array.isArray(result)) {
    for (let i = 0; i + 1 < result.length; i += 2) out[result[i]] = result[i + 1];
  } else if (result && typeof result === 'object') {
    Object.assign(out, result);
  }
  return out;
}
