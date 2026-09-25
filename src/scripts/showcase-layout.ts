/** Where project tiles go on the background slot grid. Pure: no DOM. */
import { BOARD_PITCH, BOARD_SLOT, type SlotGrid } from "./board/math";
import { cellKey } from "./crossword";
import type { Pt } from "./motion";

/** A tile's size in board slots. */
export interface TileSize {
  cols: number;
  rows: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Arrangement {
  size: TileSize;
  /** Top-left cell of each tile, in project order (left to right, or top to bottom). */
  cells: { col: number; row: number }[];
}

/** Cells whose slot comes within `margin` px of any of the boxes (viewport px). */
export function blockedCells(
  grid: SlotGrid,
  boxes: readonly Box[],
  margin: number,
): Set<string> {
  const blocked = new Set<string>();
  const half = BOARD_SLOT / 2;
  for (const b of boxes) {
    if (b.right <= b.left || b.bottom <= b.top) continue;
    // Slot c spans originX + c*pitch ± half; it's blocked if that span meets [left - margin, right + margin].
    const c0 = Math.ceil((b.left - margin - half - grid.originX) / BOARD_PITCH);
    const c1 = Math.floor(
      (b.right + margin + half - grid.originX) / BOARD_PITCH,
    );
    const r0 = Math.ceil((b.top - margin - half - grid.originY) / BOARD_PITCH);
    const r1 = Math.floor(
      (b.bottom + margin + half - grid.originY) / BOARD_PITCH,
    );
    for (let c = Math.max(0, c0); c <= Math.min(grid.cols - 1, c1); c++)
      for (let r = Math.max(0, r0); r <= Math.min(grid.rows - 1, r1); r++)
        blocked.add(cellKey(c, r));
  }
  return blocked;
}

/**
 * Up to `count` equal tiles in one line (a row, or a column), one empty slot apart, on free cells.
 * Of the sizes (largest first) and counts that fit, it takes the one with the most tile per tile
 * edge: count × √area. So three medium tiles beat two large ones, but two large ones beat three
 * tiny ones. Ties go to the larger size; among equal options, the one closest to `anchor` wins.
 * Returns null when not even one tile of the smallest size fits.
 */
export function arrangeTiles(opts: {
  grid: SlotGrid;
  blocked: ReadonlySet<string>;
  count: number;
  sizes: readonly TileSize[];
  anchor: Pt;
  gap?: number;
}): Arrangement | null {
  let best: (Arrangement & { score: number }) | null = null;
  for (const size of opts.sizes) {
    for (let k = opts.count; k >= 1; k--) {
      const cells = bestLine(opts, size, k);
      if (!cells) continue;
      const score = k * Math.sqrt(size.cols * size.rows);
      if (!best || score > best.score) best = { size, cells, score };
      break; // fewer tiles of the same size only score lower
    }
  }
  return best && { size: best.size, cells: best.cells };
}

/** The free line of `k` tiles of `size` closest to the anchor, or null if there's none. */
function bestLine(
  opts: Parameters<typeof arrangeTiles>[0],
  size: TileSize,
  k: number,
): Arrangement["cells"] | null {
  const { grid, blocked, anchor, gap = 1 } = opts;
  const free = (col: number, row: number) => {
    for (let c = col; c < col + size.cols; c++)
      for (let r = row; r < row + size.rows; r++)
        if (blocked.has(cellKey(c, r))) return false;
    return true;
  };
  let best: { cells: Arrangement["cells"]; score: number } | null = null;
  for (const horizontal of k > 1 ? [true, false] : [true]) {
    const step = {
      col: horizontal ? size.cols + gap : 0,
      row: horizontal ? 0 : size.rows + gap,
    };
    const w = size.cols + step.col * (k - 1);
    const h = size.rows + step.row * (k - 1);
    for (let row = 0; row + h <= grid.rows; row++) {
      for (let col = 0; col + w <= grid.cols; col++) {
        const cells = Array.from({ length: k }, (_, i) => ({
          col: col + step.col * i,
          row: row + step.row * i,
        }));
        if (!cells.every((c) => free(c.col, c.row))) continue;
        const cx = grid.originX + (col + (w - 1) / 2) * BOARD_PITCH;
        const cy = grid.originY + (row + (h - 1) / 2) * BOARD_PITCH;
        const score = Math.hypot(cx - anchor.x, cy - anchor.y);
        if (!best || score < best.score) best = { cells, score };
      }
    }
  }
  return best?.cells ?? null;
}

/** A tile's box in viewport px: it covers its slots edge to edge, including the gaps between them. */
export function tileBox(
  grid: SlotGrid,
  cell: { col: number; row: number },
  size: TileSize,
): { x: number; y: number; width: number; height: number } {
  const inset = BOARD_PITCH - BOARD_SLOT;
  return {
    x: grid.originX + cell.col * BOARD_PITCH - BOARD_SLOT / 2,
    y: grid.originY + cell.row * BOARD_PITCH - BOARD_SLOT / 2,
    width: size.cols * BOARD_PITCH - inset,
    height: size.rows * BOARD_PITCH - inset,
  };
}

/**
 * Square tiles for `count` items in a `width` × `height` box: the column count that gives the
 * largest tiles, capped at `max`. When even the best fit is below `min`, the tiles stay at `min`
 * and the grid is taller than the box (`fits` is false: the container has to scroll).
 */
export function fitGrid(opts: {
  count: number;
  width: number;
  height: number;
  gap: number;
  min: number;
  max: number;
}): { cols: number; cell: number; fits: boolean } {
  const { count, width, height, gap, min, max } = opts;
  if (count < 1) return { cols: 1, cell: min, fits: true };
  let best = { cols: 1, cell: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cell = Math.min(
      (width - gap * (cols - 1)) / cols,
      (height - gap * (rows - 1)) / rows,
    );
    if (cell > best.cell) best = { cols, cell };
  }
  const cell = Math.floor(Math.min(max, best.cell));
  if (cell >= min) return { cols: best.cols, cell, fits: true };
  // Too many to fit: as many min-size columns as the width takes, and scroll.
  const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
  return { cols: Math.min(cols, count), cell: min, fits: false };
}
