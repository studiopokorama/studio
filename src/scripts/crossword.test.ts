import { describe, expect, it } from "vitest";
import { slotGrid } from "./board/math";
import {
  cellKey,
  cells,
  placeWord,
  type CrosswordGrid,
  type Placement,
} from "./crossword";

const grid = (
  cols: number,
  rows: number,
  blocked: string[] = [],
): CrosswordGrid => ({
  cols,
  rows,
  blocked: new Set(blocked),
});
const fixed = () => 0.5;

/** Letters on the board, and a check that every run of 2+ letters is a placed word. */
function board(placed: Placement[]) {
  const letters = new Map<string, string>();
  for (const p of placed)
    for (const c of cells(p)) letters.set(cellKey(c.col, c.row), c.letter);
  return letters;
}

function runs(placed: Placement[], cols: number, rows: number): string[] {
  const letters = board(placed);
  const out: string[] = [];
  for (const [outer, inner, at] of [
    [rows, cols, (o: number, i: number) => cellKey(i, o)],
    [cols, rows, (o: number, i: number) => cellKey(o, i)],
  ] as const) {
    for (let o = 0; o < outer; o++) {
      let run = "";
      for (let i = 0; i <= inner; i++) {
        const ch = i < inner ? letters.get(at(o, i)) : undefined;
        if (ch) run += ch;
        else {
          if (run.length > 1) out.push(run);
          run = "";
        }
      }
    }
  }
  return out.sort();
}

describe("placeWord", () => {
  it("places the first word as close to the anchor as it fits", () => {
    const p = placeWord("roam", grid(20, 10), [], { col: 10, row: 5 }, fixed)!;
    expect(p).not.toBeNull();
    const center =
      p.dir === "h"
        ? { col: p.col + 1.5, row: p.row }
        : { col: p.col, row: p.row + 1.5 };
    expect(Math.hypot(center.col - 10, center.row - 5)).toBeLessThanOrEqual(
      0.5,
    );
  });

  it("crosses an existing word at a shared letter", () => {
    const first: Placement = { word: "karma", col: 5, row: 5, dir: "h" };
    const p = placeWord(
      "room",
      grid(20, 15),
      [first],
      { col: 0, row: 0 },
      fixed,
    )!;
    expect(p.dir).toBe("v");
    const shared = cells(p).filter(
      (c) => board([first]).get(cellKey(c.col, c.row)) === c.letter,
    );
    expect(shared.length).toBeGreaterThan(0);
  });

  it("keeps the board a valid crossword as words accumulate", () => {
    const words = [
      "poor",
      "roam",
      "karma",
      "pork",
      "room",
      "okra",
      "aroma",
      "park",
      "mark",
      "moor",
    ];
    let seed = 1;
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const placed: Placement[] = [];
    for (const w of words) {
      const p = placeWord(w, grid(24, 16), placed, { col: 12, row: 8 }, rng);
      expect(p, w).not.toBeNull();
      placed.push(p!);
    }
    // Every horizontal/vertical run of letters is exactly one of the placed words.
    expect(runs(placed, 24, 16)).toEqual([...words].sort());
  });

  it("never uses blocked cells", () => {
    const blocked: string[] = [];
    for (let c = 0; c < 10; c++)
      for (let r = 0; r < 4; r++) blocked.push(cellKey(c, r));
    const p = placeWord(
      "amok",
      grid(10, 6, blocked),
      [],
      { col: 5, row: 0 },
      fixed,
    )!;
    for (const c of cells(p))
      expect(blocked).not.toContain(cellKey(c.col, c.row));
  });

  it("returns null when nothing fits", () => {
    expect(
      placeWord("karma", grid(4, 4), [], { col: 0, row: 0 }, fixed),
    ).toBeNull();
    const all: string[] = [];
    for (let c = 0; c < 8; c++)
      for (let r = 0; r < 8; r++) all.push(cellKey(c, r));
    expect(
      placeWord("poor", grid(8, 8, all), [], { col: 0, row: 0 }, fixed),
    ).toBeNull();
  });

  it("is deterministic for a given rng", () => {
    const a = placeWord(
      "romp",
      grid(20, 20),
      [],
      { col: 3, row: 17 },
      () => 0.3,
    );
    const b = placeWord(
      "romp",
      grid(20, 20),
      [],
      { col: 3, row: 17 },
      () => 0.3,
    );
    expect(a).toEqual(b);
  });
});

describe("slotGrid", () => {
  it("centers a slot on the viewport center, like the shader", () => {
    const g = slotGrid(1440, 900);
    // Some cell must sit exactly on the center.
    const c = (720 - g.originX) / 48;
    const r = (450 - g.originY) / 48;
    expect(Number.isInteger(c) && Number.isInteger(r)).toBe(true);
    // Only whole slots, inside the viewport.
    expect(g.originX - 22).toBeGreaterThanOrEqual(0);
    expect(g.originX + (g.cols - 1) * 48 + 22).toBeLessThanOrEqual(1440);
    expect(g.originY + (g.rows - 1) * 48 + 22).toBeLessThanOrEqual(900);
  });
});
