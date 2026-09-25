export interface SpringConfig {
  stiffness: number;
  damping: number;
}

/** Underdamped by default: overshoots slightly, like --sp-ease-back. */
export const SNAP: SpringConfig = { stiffness: 520, damping: 27 };
/** Critically damped: no overshoot (reduced motion, held tiles). */
export const critical = (stiffness: number): SpringConfig => ({
  stiffness,
  damping: 2 * Math.sqrt(stiffness),
});

export class Spring {
  velocity = 0;
  target: number;

  constructor(
    public value: number,
    public config: SpringConfig = SNAP,
  ) {
    this.target = value;
  }

  /** Advance by dt seconds (sub-stepped for stability). Returns true while still moving. */
  step(dt: number): boolean {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force =
        -this.config.stiffness * (this.value - this.target) -
        this.config.damping * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    if (this.settled()) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }

  settled(eps = 0.01): boolean {
    return (
      Math.abs(this.value - this.target) < eps &&
      Math.abs(this.velocity) < eps * 10
    );
  }

  jump(v: number) {
    this.value = this.target = v;
    this.velocity = 0;
  }
}
