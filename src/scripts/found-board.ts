import { BOARD_PITCH, slotGrid, type SlotGrid } from "./board/math";
import { cellKey, cells, placeWord, type Placement } from "./crossword";
import type { Pt } from "./motion";

const NEW_GLOW_MS = 2400;

/**
 * Found words, kept on the background board as faint letter tiles in its slots,
 * crossword-style. Session-only: the board starts empty on every visit.
 */
export class FoundBoard {
  private words: string[] = [];
  private placed: Placement[] = [];
  private grid: SlotGrid = { cols: 0, rows: 0, originX: 0, originY: 0 };
  private glowTimer = 0;

  constructor(
    private layer: HTMLElement,
    /** Page content the words must stay clear of (viewport rects); the first one anchors the words. */
    private obstacles: () => DOMRect[],
    private reducedMotion: boolean,
  ) {}

  /** Forget every found word and clear the board. */
  reset() {
    this.clearGlow();
    this.words = [];
    this.placed = [];
    this.layer.replaceChildren();
  }

  get count() {
    return this.words.length;
  }

  /** Place a newly found word. Returns its center (viewport px), or null if the board has no room for it. */
  add(word: string): Pt | null {
    if (this.words.includes(word)) return null;
    this.words.push(word);
    this.measure();
    const p = this.place(word);
    if (!p) return null;
    this.clearGlow();
    this.renderWord(p, { fresh: true });
    this.glowTimer = window.setTimeout(() => this.clearGlow(), NEW_GLOW_MS);
    return this.center(p);
  }

  /**
   * Every word found: light the words up again one by one, in the order they were found.
   * `onWord` fires as each lights (for its note). Resolves once the last one has lit.
   */
  async replay(
    totalMs: number,
    onWord: (index: number, count: number) => void,
  ): Promise<void> {
    this.clearGlow();
    const count = this.placed.length;
    const step = this.reducedMotion ? 0 : totalMs / Math.max(1, count);
    // Read placements fresh each step: a resize or scroll can relayout the board mid-replay.
    for (let i = 0; i < this.placed.length; i++) {
      for (const c of cells(this.placed[i]!))
        this.layer
          .querySelector<HTMLElement>(`[data-cell="${cellKey(c.col, c.row)}"]`)
          ?.classList.add("is-new");
      onWord(i, count);
      if (step) await new Promise((r) => setTimeout(r, step));
    }
    this.glowTimer = window.setTimeout(() => this.clearGlow(), NEW_GLOW_MS);
  }

  /** Grid or content moved (resize, scroll): lay out every found word again, in the order they were found. */
  relayout() {
    this.measure();
    this.placed = [];
    this.layer.replaceChildren();
    for (const w of this.words) {
      const p = this.place(w);
      if (p) this.renderWord(p, { fresh: false });
    }
  }

  private measure() {
    // Same box as the board canvas (fixed, inset 0): excludes a classic scrollbar, unlike innerWidth.
    this.grid = slotGrid(this.layer.clientWidth, this.layer.clientHeight);
  }

  private place(word: string): Placement | null {
    const { cols, rows } = this.grid;
    const blocked = new Set<string>();
    let anchor = { col: cols / 2, row: rows / 2 };
    for (const [i, r] of this.obstacles().entries()) {
      if (!r.width || !r.height) continue;
      // Keep a one-slot margin around content.
      const c0 = this.colAt(r.left - BOARD_PITCH);
      const c1 = this.colAt(r.right + BOARD_PITCH);
      const r0 = this.rowAt(r.top - BOARD_PITCH);
      const r1 = this.rowAt(r.bottom + BOARD_PITCH);
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        for (let rr = Math.max(0, r0); rr <= Math.min(rows - 1, r1); rr++)
          blocked.add(cellKey(c, rr));
      }
      // Words gather around the first obstacle (the wordmark).
      if (i === 0)
        anchor = {
          col: this.colAt(r.left + r.width / 2),
          row: this.rowAt(r.top + r.height / 2),
        };
    }
    // Seeded by word count so a relayout reproduces the same board.
    const p = placeWord(
      word,
      { cols, rows, blocked },
      this.placed,
      anchor,
      mulberry32(this.placed.length + 1),
    );
    if (p) this.placed.push(p);
    return p;
  }

  /** Grid column whose slot overlaps x (may be out of range). */
  private colAt(x: number) {
    return Math.round((x - this.grid.originX) / BOARD_PITCH);
  }

  private rowAt(y: number) {
    return Math.round((y - this.grid.originY) / BOARD_PITCH);
  }

  private center(p: Placement): Pt {
    const cs = cells(p);
    const a = cs[0]!;
    const b = cs[cs.length - 1]!;
    return {
      x: this.grid.originX + ((a.col + b.col) / 2) * BOARD_PITCH,
      y: this.grid.originY + ((a.row + b.row) / 2) * BOARD_PITCH,
    };
  }

  private renderWord(p: Placement, { fresh }: { fresh: boolean }) {
    const existing = new Set(
      [...this.layer.children].map((el) => (el as HTMLElement).dataset.cell),
    );
    cells(p).forEach((c, i) => {
      const key = cellKey(c.col, c.row);
      if (existing.has(key)) {
        // Crossing letter: already on the board; just light it up with the new word.
        if (fresh)
          this.layer
            .querySelector<HTMLElement>(`[data-cell="${key}"]`)
            ?.classList.add("is-new");
        return;
      }
      const tile = document.createElement("span");
      const x = this.grid.originX + c.col * BOARD_PITCH;
      const y = this.grid.originY + c.row * BOARD_PITCH;
      tile.className = "fw-tile";
      tile.textContent = c.letter;
      tile.dataset.cell = key;
      tile.dataset.x = String(x);
      tile.dataset.y = String(y);
      tile.style.left = `${x}px`;
      tile.style.top = `${y}px`;
      if (fresh) {
        tile.classList.add("is-new");
        if (!this.reducedMotion) {
          tile.classList.add("is-dropping");
          tile.style.setProperty("--drop-delay", `${i * 55}ms`);
        }
      }
      this.layer.append(tile);
    });
  }

  private clearGlow() {
    clearTimeout(this.glowTimer);
    for (const el of this.layer.querySelectorAll(".is-new"))
      el.classList.remove("is-new");
  }
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
