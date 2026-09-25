/** Pure helpers for the board; no DOM or GL access. */

export const MAX_DPR = 2;
/** Slot grid geometry (CSS px), shared with the shader and the found-words layer. */
export const BOARD_PITCH = 48;
export const BOARD_SLOT = 44;
export const BOARD_RADIUS = 8;

export interface SlotGrid {
  cols: number;
  rows: number;
  /** Viewport position (CSS px, y down) of the center of cell (0, 0). */
  originX: number;
  originY: number;
}

/**
 * Whole slots visible in a viewport. One slot is centered on the viewport center,
 * exactly like the shader's grid, so cell (c, r) sits at origin + (c, r) * pitch.
 */
export function slotGrid(width: number, height: number): SlotGrid {
  const half = BOARD_SLOT / 2;
  const span = (size: number) => {
    const first = Math.ceil((-size / 2 + half) / BOARD_PITCH);
    const last = Math.floor((size / 2 - half) / BOARD_PITCH);
    return { first, count: Math.max(0, last - first + 1) };
  };
  const x = span(width);
  const y = span(height);
  return {
    cols: x.count,
    rows: y.count,
    originX: width / 2 + x.first * BOARD_PITCH,
    originY: height / 2 + y.first * BOARD_PITCH,
  };
}
export const RIPPLE_LIFETIME = 1.4; // s
export const RIPPLE_DECAY = 3; // 1/s, exponential envelope

export interface Ripple {
  x: number; // CSS px, y down
  y: number;
  start: number; // ms, performance.now() clock
  strength: number; // 0..1
}

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function clampDpr(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(dpr, MAX_DPR);
}

/** Frame-rate independent exponential smoothing; snaps once within eps. */
export function smoothToward(
  current: number,
  target: number,
  dt: number,
  rate: number,
  eps: number,
): number {
  const next = current + (target - current) * (1 - Math.exp(-rate * dt));
  return Math.abs(target - next) < eps ? target : next;
}

/** Envelope in 0..1 of a ripple at age seconds; 0 once expired. Fades to exactly 0 at lifetime. */
export function rippleEnvelope(age: number): number {
  if (age < 0 || age >= RIPPLE_LIFETIME) return 0;
  return Math.exp(-RIPPLE_DECAY * age) * (1 - age / RIPPLE_LIFETIME);
}

/** Viewport CSS px (y down) to shader space (CSS px, y up). */
export function toGlY(y: number, viewportHeight: number): number {
  return viewportHeight - y;
}

/**
 * Writes ripples into a vec4 array (x, y-up, age s, amplitude) and returns how many are alive.
 * Slots without a live ripple get amplitude 0.
 */
export function packRipples(
  ripples: readonly (Ripple | null)[],
  now: number,
  viewportHeight: number,
  out: Float32Array,
): number {
  let alive = 0;
  const slots = out.length / 4;
  for (let i = 0; i < slots; i++) {
    const r = ripples[i];
    const o = i * 4;
    const age = r ? (now - r.start) / 1000 : -1;
    const amp = r ? rippleEnvelope(age) * r.strength : 0;
    if (r && amp > 0) {
      out[o] = r.x;
      out[o + 1] = toGlY(r.y, viewportHeight);
      out[o + 2] = age;
      out[o + 3] = amp;
      alive++;
    } else {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    }
  }
  return alive;
}

/** Index to write a new ripple into: first empty/expired slot, else the oldest. */
export function rippleSlot(
  ripples: readonly (Ripple | null)[],
  now: number,
): number {
  let oldest = 0;
  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i];
    if (!r || now - r.start >= RIPPLE_LIFETIME * 1000) return i;
    if (r.start < ripples[oldest]!.start) oldest = i;
  }
  return oldest;
}
