import { describe, expect, it } from "vitest";
import { BOARD_PITCH, type SlotGrid } from "./board/math";
import { cellKey } from "./crossword";
import {
  arrangeTiles,
  blockedCells,
  fitGrid,
  tileBox,
} from "./showcase-layout";

// Cell (c, r) is centered at (c*48, r*48): easy to reason about.
const grid = (cols: number, rows: number): SlotGrid => ({
  cols,
  rows,
  originX: 0,
  originY: 0,
});
const LARGE = { cols: 5, rows: 3 };
const SMALL = { cols: 3, rows: 2 };

describe("blockedCells", () => {
  it("blocks every slot a box overlaps, and nothing else", () => {
    // x 40..60 touches slots 0 (-22..22)? no; slot 1 (26..70) yes. y 0..10: slot 0 only.
    const b = blockedCells(
      grid(5, 5),
      [{ left: 40, top: 0, right: 60, bottom: 10 }],
      0,
    );
    expect([...b]).toEqual([cellKey(1, 0)]);
  });

  it("widens boxes by the margin", () => {
    const b = blockedCells(
      grid(5, 5),
      [{ left: 40, top: 0, right: 60, bottom: 10 }],
      20,
    );
    // Now x 20..80 reaches slots 0 (up to 22) and 2 (from 74); y -20..30 reaches row 1 (from 26).
    for (const c of [0, 1, 2])
      for (const r of [0, 1]) expect(b.has(cellKey(c, r))).toBe(true);
    expect(b.size).toBe(6);
  });

  it("ignores empty boxes and clips to the grid", () => {
    expect(
      blockedCells(grid(3, 3), [{ left: 5, top: 5, right: 5, bottom: 9 }], 0)
        .size,
    ).toBe(0);
    const all = blockedCells(
      grid(3, 3),
      [{ left: -999, top: -999, right: 999, bottom: 999 }],
      0,
    );
    expect(all.size).toBe(9);
  });
});

describe("arrangeTiles", () => {
  const anchor = { x: 0, y: 0 };

  it("puts all the tiles in a row, one slot apart, as close to the anchor as possible", () => {
    const a = arrangeTiles({
      grid: grid(20, 10),
      blocked: new Set(),
      count: 3,
      sizes: [LARGE, SMALL],
      anchor,
    });
    expect(a?.size).toEqual(LARGE);
    expect(a?.cells).toEqual([
      { col: 0, row: 0 },
      { col: 6, row: 0 },
      { col: 12, row: 0 },
    ]);
  });

  it("takes two larger tiles over three much smaller ones", () => {
    // 11 columns: two large tiles (5 + 1 + 5), or three small ones (3 + 1 + 3 + 1 + 3).
    const a = arrangeTiles({
      grid: grid(11, 3),
      blocked: new Set(),
      count: 3,
      sizes: [LARGE, SMALL],
      anchor,
    });
    expect(a?.size).toEqual(LARGE);
    expect(a?.cells).toHaveLength(2);
  });

  it("goes smaller rather than show a single large tile", () => {
    // 7 columns: two small tiles fit side by side (3 + 1 + 3), only one large one.
    const a = arrangeTiles({
      grid: grid(7, 3),
      blocked: new Set(),
      count: 3,
      sizes: [LARGE, SMALL],
      anchor,
    });
    expect(a?.size).toEqual(SMALL);
    expect(a?.cells).toHaveLength(2);
  });

  it("takes three tiles over two only a little larger", () => {
    const HUGE = { cols: 6, rows: 3 };
    // 17 columns: two huge tiles (6 + 1 + 6), or three large ones (5 + 1 + 5 + 1 + 5).
    const a = arrangeTiles({
      grid: grid(17, 3),
      blocked: new Set(),
      count: 3,
      sizes: [HUGE, LARGE, SMALL],
      anchor,
    });
    expect(a?.size).toEqual(LARGE);
    expect(a?.cells).toHaveLength(3);
  });

  it("settles for one large tile when no size fits two", () => {
    const a = arrangeTiles({
      grid: grid(6, 3),
      blocked: new Set(),
      count: 3,
      sizes: [LARGE, SMALL],
      anchor,
    });
    expect(a?.size).toEqual(LARGE);
    expect(a?.cells).toHaveLength(1);
  });

  it("stacks the tiles in a column when only a column is free", () => {
    const a = arrangeTiles({
      grid: grid(5, 11),
      blocked: new Set(),
      count: 3,
      sizes: [LARGE],
      anchor,
    });
    expect(a?.cells).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 4 },
      { col: 0, row: 8 },
    ]);
  });

  it("keeps every tile off blocked cells", () => {
    const blocked = new Set<string>();
    for (let r = 0; r < 10; r++) blocked.add(cellKey(6, r)); // a wall at column 6
    const a = arrangeTiles({
      grid: grid(14, 3),
      blocked,
      count: 3,
      sizes: [LARGE, SMALL],
      anchor: { x: 13 * BOARD_PITCH, y: 0 },
    });
    expect(a).not.toBeNull();
    for (const c of a!.cells)
      for (let dc = 0; dc < a!.size.cols; dc++)
        for (let dr = 0; dr < a!.size.rows; dr++)
          expect(blocked.has(cellKey(c.col + dc, c.row + dr))).toBe(false);
  });

  it("returns null when nothing fits", () => {
    expect(
      arrangeTiles({
        grid: grid(2, 2),
        blocked: new Set(),
        count: 3,
        sizes: [SMALL],
        anchor,
      }),
    ).toBeNull();
  });
});

describe("tileBox", () => {
  it("covers its slots edge to edge", () => {
    const g = { cols: 10, rows: 10, originX: 100, originY: 50 };
    expect(tileBox(g, { col: 1, row: 2 }, SMALL)).toEqual({
      x: 100 + 48 - 22,
      y: 50 + 96 - 22,
      width: 3 * 48 - 4,
      height: 2 * 48 - 4,
    });
  });
});

describe("fitGrid", () => {
  const base = { gap: 10, min: 96, max: 400 };

  it("makes a 2×2 grid when that gives bigger squares than one row", () => {
    // One row of 4: (1370 - 30) / 4 = 335. Two rows of 2: min(680, (690 - 10) / 2 = 340).
    expect(fitGrid({ ...base, count: 4, width: 1370, height: 690 })).toEqual({
      cols: 2,
      cell: 340,
      fits: true,
    });
  });

  it("uses one row when the box is wide and short", () => {
    expect(fitGrid({ ...base, count: 3, width: 1000, height: 300 })).toEqual({
      cols: 3,
      cell: 300,
      fits: true,
    });
  });

  it("caps the tile size", () => {
    expect(fitGrid({ ...base, count: 1, width: 2000, height: 2000 }).cell).toBe(
      400,
    );
  });

  it("falls back to minimum-size tiles, and says it doesn't fit, when there are too many", () => {
    const g = fitGrid({ ...base, count: 40, width: 320, height: 400 });
    expect(g).toEqual({ cols: 3, cell: 96, fits: false });
  });
});
