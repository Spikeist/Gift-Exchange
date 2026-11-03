// Shared helpers for the participant and organizer pages.

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(action, data = {}, { session } = {}) {
  let res;
  try {
    res = await fetch('/api/exchange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session}` } : {}),
      },
      body: JSON.stringify({ ...data, action }),
    });
  } catch {
    throw new ApiError("Couldn't connect. Check your internet connection and try again.", 0, 'OFFLINE');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    throw new ApiError(
      (body && body.error) || `Something went wrong (error ${res.status}). Try again in a moment.`,
      res.status,
      body && body.code
    );
  }
  return body;
}

/** Build an element: el('p', { class: 'x', onclick: fn }, 'text', child) */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'value') node.value = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  gift: [
    ['rect', { x: 3.5, y: 9, width: 17, height: 11.5, rx: 1.5 }],
    ['path', { d: 'M2.5 9h19M12 9v11.5' }],
    ['path', { d: 'M12 9c-1.5-3.5-5.5-4.5-6-2.2C5.6 8.6 9 9 12 9zm0 0c1.5-3.5 5.5-4.5 6-2.2.4 1.8-3 2.2-6 2.2z' }],
  ],
  external: [['path', { d: 'M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10' }]],
  copy: [
    ['rect', { x: 8.5, y: 8.5, width: 11.5, height: 11.5, rx: 2 }],
    ['path', { d: 'M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3' }],
  ],
  share: [['path', { d: 'M12 15V3.5M7.5 8 12 3.5 16.5 8M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  pending: [['circle', { cx: 12, cy: 12, r: 6.5 }]],
  edit: [['path', { d: 'M4 20h4.5L19.5 9 15 4.5 4 15.5zM13 6.5l4.5 4.5' }]],
  tap: [['path', { d: 'M9 11V5.5a1.75 1.75 0 0 1 3.5 0V11m0-1.5a1.75 1.75 0 0 1 3.5 0V12m0-1a1.75 1.75 0 0 1 3.5 0v3.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.6-2.2L4.5 15a1.8 1.8 0 0 1 2.7-2.3L9 14.5' }]],
};

export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of ICONS[name] || []) {
    const part = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, String(v));
    svg.append(part);
  }
  return svg;
}

/** Only allow http(s) links into href attributes. */
export function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Plain text with web addresses turned into links. Never parses HTML. */
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<>"']+/gi;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    let url = match[0];
    const trailing = url.match(/[.,;:!?)\]]+$/);
    if (trailing) url = url.slice(0, -trailing[0].length);
    const href = safeHref(url);
    frag.append(document.createTextNode(text.slice(last, match.index)));
    if (href) {
      frag.append(el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, url));
    } else {
      frag.append(document.createTextNode(url));
    }
    last = match.index + url.length;
  }
  frag.append(document.createTextNode(text.slice(last)));
  return frag;
}

export const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  },
};

export function shortDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { readonly: true, 'aria-hidden': 'true', class: 'sr-only' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

let toastTimer;
let region = null;

// Create the live region up front so screen readers announce the first toast too.
function toastRegion() {
  if (!region) {
    region = el('div', { id: 'toast-region', class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  return region;
}
if (document.body) toastRegion();
else document.addEventListener('DOMContentLoaded', toastRegion);

export function toast(message, { error = false } = {}) {
  const region = toastRegion();
  region.replaceChildren(el('div', { class: 'toast' + (error ? ' is-error' : '') }, message));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    const t = region.firstChild;
    if (!t) return;
    t.classList.add('is-leaving');
    setTimeout(() => t.remove(), 250);
  }, error ? 6000 : 2600);
}

/** Set a button to a busy state while `work` runs. */
export async function busy(button, work) {
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.classList.add('is-busy');
  button.setAttribute('aria-busy', 'true');
  try {
    return await work();
  } finally {
    button.disabled = wasDisabled;
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
  }
}
