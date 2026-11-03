import { randomInt } from 'node:crypto';

export class DrawError extends Error {}

function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rand(0, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Match every giver to a receiver.
 * - Nobody gets themselves.
 * - People in a keep-apart pair never get each other (either direction).
 * - Every valid outcome is equally likely: shuffle until one passes.
 *
 * @param {string[]} ids      person ids
 * @param {Array<[string,string]>} pairs  keep-apart pairs
 * @param {(min:number,max:number)=>number} rand  uniform integer in [min, max)
 * @returns {Record<string,string>} giverId -> receiverId
 */
export function makeDraw(ids, pairs = [], rand = randomInt) {
  const n = ids.length;
  if (n < 3) throw new DrawError('Add at least 3 people before drawing names.');
  if (new Set(ids).size !== n) throw new DrawError('Duplicate people in the draw.');

  const blocked = new Set();
  for (const [a, b] of pairs) {
    blocked.add(a + '|' + b);
    blocked.add(b + '|' + a);
  }
  const allowed = (giver, receiver) =>
    giver !== receiver && !blocked.has(giver + '|' + receiver);

  // Rejection sampling: a uniformly random shuffle, kept only if every match
  // is allowed. Without pairs about 37% of shuffles pass, so this ends fast.
  for (let attempt = 0; attempt < 20000; attempt++) {
    const receivers = shuffle(ids.slice(), rand);
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (!allowed(ids[i], receivers[i])) {
        ok = false;
        break;
      }
    }
    if (ok) return Object.fromEntries(ids.map((g, i) => [g, receivers[i]]));
  }

  // Very tight rules: search directly so we either find a draw or know
  // for sure that none exists.
  const found = search(ids, allowed, rand);
  if (!found) {
    throw new DrawError(
      'No draw is possible with the current keep-apart pairs. Remove a pair and try again.'
    );
  }
  return found;
}

function search(ids, allowed, rand) {
  const options = ids.map((g) => ids.filter((r) => allowed(g, r)));
  // Fill the most constrained givers first.
  const order = ids.map((_, i) => i).sort((a, b) => options[a].length - options[b].length);
  const used = new Set();
  const out = {};
  let steps = 0;
  const go = (k) => {
    if (++steps > 2_000_000) return false;
    if (k === ids.length) return true;
    const gi = order[k];
    for (const r of shuffle(options[gi].slice(), rand)) {
      if (used.has(r)) continue;
      used.add(r);
      out[ids[gi]] = r;
      if (go(k + 1)) return true;
      used.delete(r);
      delete out[ids[gi]];
    }
    return false;
  };
  return go(0) ? out : null;
}

/** Walk the matches as loops: A gives to B, B gives to C, C gives to A. */
export function revealOrder(peopleInOrder, draw) {
  const visited = new Set();
  const rows = [];
  let loop = 0;
  for (const p of peopleInOrder) {
    if (visited.has(p.id) || !draw[p.id]) continue;
    loop += 1;
    let cur = p.id;
    while (!visited.has(cur) && draw[cur]) {
      visited.add(cur);
      rows.push({ giverId: cur, receiverId: draw[cur], loop });
      cur = draw[cur];
    }
  }
  return rows;
}
