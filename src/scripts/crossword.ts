/** Crossword-style placement of found words on the background slot grid. Pure: no DOM. */

export type Direction = "h" | "v";

export interface Placement {
  word: string;
  col: number;
  row: number;
  dir: Direction;
}

export interface CrosswordGrid {
  cols: number;
  rows: number;
  /** Cells that must stay empty (e.g. behind the hero content). */
  blocked: ReadonlySet<string>;
}

export const cellKey = (col: number, row: number) => `${col},${row}`;

/** Cells a placement covers, first letter first. */
export function cells(
  p: Placement,
): { col: number; row: number; letter: string }[] {
  return [...p.word].map((letter, i) => ({
    col: p.col + (p.dir === "h" ? i : 0),
    row: p.row + (p.dir === "v" ? i : 0),
    letter,
  }));
}

interface Occupied {
  letter: string;
  dirs: Set<Direction>;
}

function occupancy(placed: readonly Placement[]): Map<string, Occupied> {
  const map = new Map<string, Occupied>();
  for (const p of placed) {
    for (const c of cells(p)) {
      const key = cellKey(c.col, c.row);
      const cur = map.get(key);
      if (cur) cur.dirs.add(p.dir);
      else map.set(key, { letter: c.letter, dirs: new Set([p.dir]) });
    }
  }
  return map;
}

/** How many existing letters the placement reuses, or -1 if it breaks crossword rules. */
function fit(
  p: Placement,
  grid: CrosswordGrid,
  occ: Map<string, Occupied>,
): number {
  const [dc, dr] = p.dir === "h" ? [1, 0] : [0, 1];
  const inBounds = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < grid.cols && r < grid.rows;
  const empty = (c: number, r: number) => !occ.has(cellKey(c, r));

  // Nothing directly before the first or after the last letter: the word must not run into another.
  const n = p.word.length;
  if (!empty(p.col - dc, p.row - dr) || !empty(p.col + dc * n, p.row + dr * n))
    return -1;

  let crossings = 0;
  for (const c of cells(p)) {
    if (!inBounds(c.col, c.row) || grid.blocked.has(cellKey(c.col, c.row)))
      return -1;
    const hit = occ.get(cellKey(c.col, c.row));
    if (hit) {
      // Crossing: same letter, and only across a word running the other way.
      if (hit.letter !== c.letter || hit.dirs.has(p.dir)) return -1;
      crossings++;
    } else if (
      !empty(c.col + dr, c.row + dc) ||
      !empty(c.col - dr, c.row - dc)
    ) {
      // A new letter may not sit alongside another word (that would spell nonsense across).
      return -1;
    }
  }
  return crossings === n ? -1 : crossings;
}

/** Occupied cells around the new letters (8-neighbourhood, and two past each end): lower reads calmer. */
function crowding(p: Placement, occ: Map<string, Occupied>): number {
  const own = new Set(cells(p).map((c) => cellKey(c.col, c.row)));
  const seen = new Set<string>();
  const [dc, dr] = p.dir === "h" ? [1, 0] : [0, 1];
  const n = p.word.length;
  const around: [number, number][] = [
    [p.col - 2 * dc, p.row - 2 * dr],
    [p.col + (n + 1) * dc, p.row + (n + 1) * dr],
  ];
  for (const c of cells(p)) {
    if (occ.has(cellKey(c.col, c.row))) continue; // crossing letters are meant to touch
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) around.push([c.col + dx, c.row + dy]);
  }
  for (const [c, r] of around) {
    const key = cellKey(c, r);
    if (!own.has(key) && occ.has(key)) seen.add(key);
  }
  return seen.size;
}

function centerOf(p: Placement) {
  const half = (p.word.length - 1) / 2;
  return {
    col: p.col + (p.dir === "h" ? half : 0),
    row: p.row + (p.dir === "v" ? half : 0),
  };
}

/**
 * Place `word` on the grid. Prefers crossing an already placed word at a shared letter;
 * otherwise picks an uncrowded free spot nearest `anchor`. Returns null when nothing fits.
 * `rng` only breaks ties, so results are deterministic for a given rng.
 */
export function placeWord(
  word: string,
  grid: CrosswordGrid,
  placed: readonly Placement[],
  anchor: { col: number; row: number },
  rng: () => number = Math.random,
): Placement | null {
  if (!word) throw new Error("empty word");
  const occ = occupancy(placed);
  const candidates: {
    p: Placement;
    crossings: number;
    crowd: number;
    dist: number;
    tie: number;
  }[] = [];
  const consider = (p: Placement) => {
    const crossings = fit(p, grid, occ);
    if (crossings < 0) return;
    const c = centerOf(p);
    candidates.push({
      p,
      crossings,
      crowd: crowding(p, occ),
      dist: Math.hypot(c.col - anchor.col, c.row - anchor.row),
      tie: rng(),
    });
  };

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      consider({ word, col, row, dir: "h" });
      consider({ word, col, row, dir: "v" });
    }
  }
  if (!candidates.length) return null;

  const crossing = candidates.filter((c) => c.crossings > 0);
  const pool = crossing.length ? crossing : candidates;
  // Crossing first, then breathing room, then closeness to the anchor.
  pool.sort(
    (a, b) =>
      b.crossings - a.crossings ||
      a.crowd - b.crowd ||
      a.dist - b.dist ||
      a.tie - b.tie,
  );
  return pool[0]!.p;
}
