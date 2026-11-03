import { pbkdf2, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);
const ITERATIONS = 210000; // PBKDF2-HMAC-SHA512
const SESSION_DAYS = 90;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = (await pbkdf2Async(password, salt, ITERATIONS, 32, 'sha512')).toString('base64url');
  // `secret` signs organizer sessions. Replacing it signs everyone out.
  return { salt, hash, iterations: ITERATIONS, secret: randomBytes(32).toString('base64url') };
}

export async function checkPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const got = await pbkdf2Async(password, record.salt, record.iterations || ITERATIONS, 32, 'sha512');
  const want = Buffer.from(record.hash, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want);
}

export function makeSession(record) {
  const expires = String(Date.now() + SESSION_DAYS * 864e5);
  const sig = createHmac('sha256', record.secret).update(expires).digest('base64url');
  return `${expires}.${sig}`;
}

export function checkSession(token, record) {
  if (!token || !record || !record.secret) return false;
  const [expires, sig] = String(token).split('.');
  if (!expires || !sig || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  const want = createHmac('sha256', record.secret).update(expires).digest();
  const got = Buffer.from(sig, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** 128-bit random token for a personal link. */
export function newLinkToken() {
  return randomBytes(16).toString('base64url');
}

export function newId() {
  return randomBytes(6).toString('base64url');
}
