import { planMove, sampleStroke, tremor, type Pt } from "./motion";

export interface MoveOptions {
  signal: AbortSignal;
  /** Target size in px for Fitts's law: small targets are approached more carefully. */
  width?: number;
  /** Called with every new position (used to drag a held tile along). */
  onStep?: (p: Pt) => void;
  /** While true, the hand holds still (up to a limit) — e.g. the visitor's pointer is right there. */
  pauseWhen?: () => boolean;
}

const MAX_PAUSE_MS = 1500;

export class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortedError";
  }
}

export const isAborted = (e: unknown) => e instanceof AbortedError;

/** The lime "studio" cursor: a second pair of hands on the page. */
export class BotCursor {
  pos: Pt = { x: -100, y: -100 };
  private pin: (() => Pt) | null = null;
  private seed = Math.random() * 100;
  private sayTimer = 0;

  constructor(
    private el: HTMLElement,
    private label: HTMLElement,
    private reducedMotion: boolean,
  ) {}

  show() {
    this.el.classList.add("is-visible");
  }

  /** Stick to a moving point (e.g. the resting tile) until the next move. */
  pinTo(fn: () => Pt) {
    this.pin = fn;
    this.refresh();
  }

  /** Re-apply the pin; call whenever whatever it follows has moved. */
  refresh() {
    if (!this.pin) return;
    this.pos = this.pin();
    this.render(this.pos);
  }

  setAway(away: boolean) {
    this.el.classList.toggle("is-away", away);
  }

  say(text: string, ms = 1800) {
    clearTimeout(this.sayTimer);
    this.label.textContent = text;
    this.el.classList.add("is-talking");
    this.sayTimer = window.setTimeout(() => {
      this.el.classList.remove("is-talking");
      this.label.textContent = "studio";
    }, ms);
  }

  setScale(s: number) {
    this.el.style.setProperty("--cursor-scale", String(s));
  }

  jump(p: Pt) {
    this.pin = null;
    this.pos = p;
    this.render(p);
  }

  /** Move like a hand would: curved minimum-jerk strokes, occasional overshoot and correction, slight tremor. */
  async moveTo(to: Pt, opts: MoveOptions): Promise<void> {
    this.pin = null;
    if (opts.signal.aborted) throw new AbortedError();
    if (this.reducedMotion) {
      this.pos = to;
      this.render(to);
      opts.onStep?.(to);
      return;
    }
    for (const stroke of planMove(this.pos, to, opts.width ?? 24)) {
      await this.runStroke(
        stroke.duration,
        (t) => sampleStroke(stroke, t),
        opts,
      );
      if (stroke.pauseAfter) await this.hold(stroke.pauseAfter, opts);
    }
    this.pos = to;
    this.render(to);
    opts.onStep?.(to);
  }

  /** Stay put for `ms`, still trembling slightly; honours abort. */
  hold(
    ms: number,
    opts: Pick<MoveOptions, "signal" | "onStep">,
  ): Promise<void> {
    const at = this.pos;
    return this.runStroke(ms, () => at, opts);
  }

  private runStroke(
    duration: number,
    at: (t: number) => Pt,
    opts: MoveOptions | Pick<MoveOptions, "signal" | "onStep">,
  ): Promise<void> {
    const pauseWhen = "pauseWhen" in opts ? opts.pauseWhen : undefined;
    return new Promise((resolve, reject) => {
      let elapsed = 0;
      let paused = 0;
      let last = performance.now();
      const onAbort = () => {
        cancelAnimationFrame(raf);
        reject(new AbortedError());
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });
      const tick = (now: number) => {
        const dt = now - last;
        last = now;
        if (pauseWhen?.() && paused < MAX_PAUSE_MS) paused += dt;
        else elapsed += dt;
        const t = Math.min(1, elapsed / Math.max(1, duration));
        const p = at(t);
        this.pos = p;
        const shake = tremor(now, this.seed);
        this.render({ x: p.x + shake.x, y: p.y + shake.y });
        opts.onStep?.(p);
        if (t < 1) raf = requestAnimationFrame(tick);
        else {
          opts.signal.removeEventListener("abort", onAbort);
          resolve();
        }
      };
      let raf = requestAnimationFrame(tick);
    });
  }

  private render(p: Pt) {
    this.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
  }
}
