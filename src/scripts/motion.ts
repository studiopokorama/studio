export interface Pt {
  x: number;
  y: number;
}

/** One submovement: a slightly curved stroke with a minimum-jerk speed profile. */
export interface Stroke {
  from: Pt;
  to: Pt;
  ctrl: Pt;
  duration: number; // ms
  pauseAfter: number; // ms
}

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Fitts's law: time to hit a target of `width` px at `distance` px. */
export function fittsDuration(distance: number, width: number): number {
  const ms = 190 + 125 * Math.log2(distance / Math.max(width, 1) + 1);
  return Math.min(1150, Math.max(140, ms));
}

/** Minimum-jerk position profile (0..1 → 0..1): how a hand accelerates and brakes. */
export function minJerk(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * u * (10 - 15 * u + 6 * u * u);
}

/**
 * Plan a human-looking move: a curved primary stroke that sometimes overshoots,
 * followed by a short corrective stroke onto the target.
 */
export function planMove(
  from: Pt,
  to: Pt,
  targetWidth: number,
  rng: () => number = Math.random,
): Stroke[] {
  const d = dist(from, to);
  if (d < 1) return [];
  const dx = (to.x - from.x) / d;
  const dy = (to.y - from.y) / d;
  // Hands arc; bend to a random side by up to ~12% of the distance.
  const bend = (rng() - 0.5) * 0.24 * d;
  const curve = (a: Pt, b: Pt, k: number): Pt => ({
    x: (a.x + b.x) / 2 - dy * k,
    y: (a.y + b.y) / 2 + dx * k,
  });

  const overshoots = d > 140 && rng() < 0.45;
  if (!overshoots) {
    return [
      {
        from,
        to,
        ctrl: curve(from, to, bend),
        duration: fittsDuration(d, targetWidth),
        pauseAfter: 0,
      },
    ];
  }
  const over = d * (0.04 + rng() * 0.05);
  const side = (rng() - 0.5) * 0.3 * over;
  const land = {
    x: to.x + dx * over - dy * side,
    y: to.y + dy * over + dx * side,
  };
  return [
    {
      from,
      to: land,
      ctrl: curve(from, land, bend),
      duration: fittsDuration(d, targetWidth) * 0.92,
      pauseAfter: 40 + rng() * 60,
    },
    {
      from: land,
      to,
      ctrl: curve(land, to, 0),
      duration: 110 + rng() * 90,
      pauseAfter: 0,
    },
  ];
}

/** Position along a stroke at time fraction t (0..1). */
export function sampleStroke(s: Stroke, t: number): Pt {
  const u = minJerk(t);
  const a = 1 - u;
  return {
    x: a * a * s.from.x + 2 * a * u * s.ctrl.x + u * u * s.to.x,
    y: a * a * s.from.y + 2 * a * u * s.ctrl.y + u * u * s.to.y,
  };
}

/** Small physiological tremor (px), smooth in time. */
export function tremor(timeMs: number, seed: number, amp = 0.6): Pt {
  const t = timeMs / 1000;
  return {
    x:
      amp *
      (Math.sin(t * 9.1 + seed) * 0.6 + Math.sin(t * 13.7 + seed * 2.1) * 0.4),
    y:
      amp *
      (Math.sin(t * 8.3 + seed * 1.7) * 0.6 +
        Math.sin(t * 12.9 + seed * 0.5) * 0.4),
  };
}
