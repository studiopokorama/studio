export const TARGET = "pokorama";
/** Slot of the tile lifted out in the resting pose (0 = "p", 3 = the brand's second "o"). */
export const REST_INDEX = 3;

/** Words (4+ letters) hidden in p-o-k-o-r-a-m-a (each letter used at most as often as it appears; none already visible in it, like "ram"). */
export const HIDDEN_WORDS = [
  "aroma",
  "karma",
  "korma",
  "parka",
  "promo",
  "amok",
  "mark",
  "moor",
  "okra",
  "park",
  "poor",
  "pork",
  "pram",
  "ramp",
  "roam",
  "romp",
  "rook",
  "room",
] as const;

/** Longest hidden word appearing as a contiguous run in `row`, or null. */
export function findHiddenWord(row: string): string | null {
  let best: string | null = null;
  for (const w of HIDDEN_WORDS) {
    if (row.includes(w) && (!best || w.length > best.length)) best = w;
  }
  return best;
}

/** Remove the tile at its current index and re-insert it at `to` (index in the list after removal). */
export interface Move {
  tile: number;
  to: number;
}

export function applyMove(order: readonly number[], m: Move): number[] {
  const next = order.filter((id) => id !== m.tile);
  if (next.length === order.length)
    throw new Error(`tile ${m.tile} not in order`);
  if (m.to < 0 || m.to > next.length)
    throw new Error(`move target ${m.to} out of range`);
  next.splice(m.to, 0, m.tile);
  return next;
}

/** Indices (into `seq`) of one longest strictly increasing subsequence. */
function lisIndices(seq: readonly number[]): Set<number> {
  const len = seq.map(() => 1);
  const prev = seq.map(() => -1);
  for (let i = 0; i < seq.length; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j]! < seq[i]! && len[j]! + 1 > len[i]!) {
        len[i] = len[j]! + 1;
        prev[i] = j;
      }
    }
  }
  let end = 0;
  for (let i = 1; i < seq.length; i++) if (len[i]! > len[end]!) end = i;
  const out = new Set<number>();
  for (let i = end; i !== -1 && seq.length > 0; i = prev[i]!) out.add(i);
  return out;
}

/** Every way to assign target positions to tiles, treating tiles with equal letters as interchangeable. */
function assignments(
  order: readonly number[],
  letters: readonly string[],
  target: string,
): Map<number, number>[] {
  const slotsByLetter = new Map<string, number[]>();
  [...target].forEach((ch, i) =>
    slotsByLetter.set(ch, [...(slotsByLetter.get(ch) ?? []), i]),
  );

  let results: Map<number, number>[] = [new Map()];
  const tilesByLetter = new Map<string, number[]>();
  for (const id of order) {
    const ch = letters[id];
    if (ch === undefined) throw new Error(`unknown tile ${id}`);
    tilesByLetter.set(ch, [...(tilesByLetter.get(ch) ?? []), id]);
  }
  for (const [ch, tiles] of tilesByLetter) {
    const slots = slotsByLetter.get(ch);
    if (!slots || slots.length !== tiles.length)
      throw new Error(`letters do not spell "${target}"`);
    const next: Map<number, number>[] = [];
    for (const perm of permutations(slots)) {
      for (const base of results) {
        const m = new Map(base);
        tiles.forEach((id, i) => m.set(id, perm[i]!));
        next.push(m);
      }
    }
    results = next;
  }
  return results;
}

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
  );
}

/**
 * Fewest insert-moves that turn `order` (tile ids, left to right) into `target`.
 * Tiles kept in place form a longest increasing run of target positions; every other tile is moved once.
 */
export function solveMoves(
  order: readonly number[],
  letters: readonly string[],
  target = TARGET,
): Move[] {
  let best: { pos: Map<number, number>; keep: Set<number> } | null = null;
  for (const pos of assignments(order, letters, target)) {
    const keep = lisIndices(order.map((id) => pos.get(id)!));
    if (!best || keep.size > best.keep.size) best = { pos, keep };
  }
  if (!best) return [];
  const { pos, keep } = best;

  const fixed = new Set(order.filter((_, i) => keep.has(i)));
  const toMove = order
    .filter((id) => !fixed.has(id))
    .sort((a, b) => pos.get(a)! - pos.get(b)!);

  const moves: Move[] = [];
  let cur = order.slice();
  for (const id of toMove) {
    const without = cur.filter((x) => x !== id);
    // Insert right before the closest fixed tile that belongs after this one.
    const successor = without.findIndex(
      (x) => fixed.has(x) && pos.get(x)! > pos.get(id)!,
    );
    const m = { tile: id, to: successor === -1 ? without.length : successor };
    moves.push(m);
    cur = applyMove(cur, m);
    fixed.add(id);
  }
  return moves;
}

/** `count` random moves that leave the word scrambled (never spelling the target). */
export function scrambleMoves(
  order: readonly number[],
  letters: readonly string[],
  count: number,
  rng = Math.random,
): Move[] {
  const spell = (o: readonly number[]) => o.map((id) => letters[id]).join("");
  for (let attempt = 0; attempt < 50; attempt++) {
    const moves: Move[] = [];
    let cur = order.slice();
    for (let i = 0; i < count; i++) {
      const tile = cur[Math.floor(rng() * cur.length)]!;
      const from = cur.indexOf(tile);
      let to = Math.floor(rng() * cur.length);
      if (to === from) to = (to + 1) % cur.length;
      const m = { tile, to };
      moves.push(m);
      cur = applyMove(cur, m);
    }
    if (spell(cur) !== TARGET) return moves;
  }
  throw new Error("could not produce a scramble");
}
