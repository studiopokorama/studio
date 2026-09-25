import { slotGrid, smoothToward } from "./board/math";
import type { Pt } from "./motion";
import {
  arrangeTiles,
  blockedCells,
  tileBox,
  type TileSize,
} from "./showcase-layout";

/** Tile sizes in board slots, largest first; the layout uses the largest that fits the most tiles. */
const SIZES: TileSize[] = [
  { cols: 3, rows: 3 },
  { cols: 2, rows: 2 },
];
/** Keep this far (px) from the page content. */
const CONTENT_MARGIN = 24;
const DROP_STAGGER_MS = 110;
const CYCLE_MS = 1100;
const MAX_TILT_DEG = 5;
const TILT_RATE = 12; // 1/s

/**
 * The latest projects as big tiles sitting in the background board's slots, placed wherever
 * the board is free next to the content. Tiles that don't fit are left out (the launcher has them all).
 */
export class Showcase {
  readonly tiles: HTMLAnchorElement[];
  private placed: HTMLAnchorElement[] = [];

  constructor(
    private layer: HTMLElement,
    private opts: {
      reducedMotion: boolean;
      finePointer: boolean;
      /** Page content the tiles must stay clear of (viewport rects). */
      obstacles: () => DOMRect[];
      /** Where the tiles would ideally sit (viewport px). */
      anchor: () => Pt;
    },
  ) {
    this.tiles = [...layer.querySelectorAll<HTMLAnchorElement>(".pt")];
    for (const tile of this.tiles) bindTile(tile, opts);
  }

  /** Place as many tiles as fit, in project order. Returns how many were placed. */
  layout(): number {
    const grid = slotGrid(this.layer.clientWidth, this.layer.clientHeight);
    const blocked = blockedCells(grid, this.opts.obstacles(), CONTENT_MARGIN);
    const arrangement = arrangeTiles({
      grid,
      blocked,
      count: this.tiles.length,
      sizes: SIZES,
      anchor: this.opts.anchor(),
    });
    this.placed = [];
    this.tiles.forEach((tile, i) => {
      const cell = arrangement?.cells[i];
      tile.classList.toggle("is-placed", !!cell);
      if (!cell || !arrangement) return;
      const box = tileBox(grid, cell, arrangement.size);
      Object.assign(tile.style, {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });
      tile.classList.toggle("is-small", arrangement.size.rows < 3);
      this.placed.push(tile);
    });
    return this.placed.length;
  }

  /** Drop the placed tiles into their slots one by one; `onLand` fires as each one lands. */
  intro(onLand: (at: Pt, index: number) => void) {
    this.layer.classList.add("is-ready");
    if (this.opts.reducedMotion) return;
    this.placed.forEach((tile, i) => {
      const card = tile.querySelector<HTMLElement>("[data-card]");
      if (!card) return;
      card.style.setProperty("--drop-delay", `${i * DROP_STAGGER_MS}ms`);
      tile.classList.add("is-dropping");
      card.addEventListener(
        "animationend",
        () => tile.classList.remove("is-dropping"),
        { once: true },
      );
      // The drop's spring lands about 60% of the way through its 520ms.
      setTimeout(() => onLand(this.center(tile), i), i * DROP_STAGGER_MS + 300);
    });
  }

  /** Viewport rects of the placed tiles. */
  rects(): DOMRect[] {
    return this.placed.map((t) => t.getBoundingClientRect());
  }

  /** The tile's card, when the project has a tile on the board right now. */
  card(id: string): HTMLElement | null {
    const tile = this.placed.find((t) => t.dataset.project === id);
    return tile?.querySelector<HTMLElement>("[data-card]") ?? null;
  }

  /** The project that's open shows as lifted out of the board: its tile leaves an empty slot. */
  setOpen(id: string | null) {
    for (const t of this.tiles)
      t.classList.toggle("is-open", t.dataset.project === id);
  }

  center(tile: HTMLElement): Pt {
    const r = tile.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
}

export interface TileOptions {
  reducedMotion: boolean;
  finePointer: boolean;
}

/**
 * A project tile's hover (on the board and in the launcher): the card lifts (CSS), the face
 * tilts toward the pointer, and the cover cycles through the project's images.
 */
export function bindTile(tile: HTMLElement, opts: TileOptions) {
  const card = tile.querySelector<HTMLElement>("[data-card]");
  if (!card) throw new Error("project tile without a card");
  const shots = [...card.querySelectorAll<HTMLImageElement>(".pt-img")];
  const show = (i: number) =>
    shots.forEach((s, j) => s.classList.toggle("is-shown", j === i));
  let cycle = 0;

  tile.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch" || opts.reducedMotion) return;
    if (shots.length < 2) return;
    card.classList.add("is-cycling");
    let i = 0;
    show(0);
    clearInterval(cycle);
    cycle = window.setInterval(() => {
      i = (i + 1) % shots.length;
      show(i);
    }, CYCLE_MS);
  });
  const tilt = tilter(card, opts);
  tile.addEventListener("pointerleave", () => {
    clearInterval(cycle);
    card.classList.remove("is-cycling");
    tilt?.(0, 0);
  });
  if (!tilt) return;
  // Tilt toward the pointer, as if the piece is being pressed where the pointer is.
  tile.addEventListener("pointermove", (e) => {
    const r = tile.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    tilt(-ny * MAX_TILT_DEG, nx * MAX_TILT_DEG);
  });
}

/**
 * Eases the card's face toward a tilt, one frame at a time. Pointer events only move the
 * target, so a stream of them never restarts the motion (as a CSS transition would).
 */
function tilter(card: HTMLElement, opts: TileOptions) {
  if (!opts.finePointer || opts.reducedMotion) return null;
  const face = card.querySelector<HTMLElement>("[data-face]");
  if (!face) throw new Error("project card without a face");
  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    cur.x = smoothToward(cur.x, target.x, dt, TILT_RATE, 0.02);
    cur.y = smoothToward(cur.y, target.y, dt, TILT_RATE, 0.02);
    face.style.transform = `perspective(700px) rotateX(${cur.x.toFixed(2)}deg) rotateY(${cur.y.toFixed(2)}deg)`;
    if (cur.x !== target.x || cur.y !== target.y)
      raf = requestAnimationFrame(frame);
    else raf = last = 0;
  };
  return (x: number, y: number) => {
    target.x = x;
    target.y = y;
    if (!raf) raf = requestAnimationFrame(frame);
  };
}
