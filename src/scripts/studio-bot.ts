import { BotCursor, isAborted } from "./cursor";
import { dist, type Pt } from "./motion";
import type { Wordmark } from "./wordmark";
import {
  REST_INDEX,
  scrambleMoves,
  solveMoves,
  TARGET,
  type Move,
} from "./words";

type Mode = "home" | "aside" | "busy";
type Task = (signal: AbortSignal) => Promise<void>;

const TIDY_AFTER_MS = 6000;
const TIDY_AFTER_SCRAMBLE_MS = 14000;
const OFFER_AFTER_IDLE_MS = 14000;
const OFFER_COOLDOWN_MS = 60000;
const NEAR_PX = 80;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => (clearTimeout(t), reject(signal.reason)),
      { once: true },
    );
  });

/**
 * The autonomous collaborator: keeps the wordmark in its resting pose, tidies up
 * after visitors, and otherwise stays out of their way.
 */
export class StudioBot {
  private mode: Mode = "home";
  private task: AbortController | null = null;
  /** Kept after the task finishes so the CTA leave can tell whether the bot is still pointing at it. */
  private taskName = "";
  private pointer: Pt | null = null;
  private pointerAt = 0;
  private lastOffer = -Infinity;
  private timers = new Map<string, number>();
  private lastDodge = 0;

  constructor(
    private wm: Wordmark,
    private cursor: BotCursor,
    private opts: {
      reducedMotion: boolean;
      finePointer: boolean;
      cta: HTMLElement | null;
    },
  ) {
    wm.on((e) => {
      if (e.type === "frame") {
        this.cursor.setScale(Math.min(1.8, Math.max(0.85, wm.tileSize / 56)));
        if (this.mode === "home") this.cursor.refresh();
      } else if (e.type === "grab" && e.holder !== "bot") {
        this.onVisitorGrab();
      } else if (e.type === "drop" && e.holder !== "bot") {
        this.onVisitorDrop(e.word);
      }
    });
    const cta = opts.cta;
    if (cta && opts.finePointer && !opts.reducedMotion) {
      cta.addEventListener("pointerenter", () => this.onCta(true));
      cta.addEventListener("pointerleave", () => this.onCta(false));
    }
  }

  /** Called once the intro has parked the tile in its resting pose. */
  start() {
    this.cursor.show();
    this.goHomeNow();
    this.scheduleFidget();
  }

  setPointer(p: Pt | null) {
    this.pointer = p;
    this.pointerAt = performance.now();
    if (p) this.maybeDodge(p);
    this.scheduleOffer();
  }

  // ─── commands ────────────────────────────────────────────────

  scramble() {
    if (this.visitorHolding()) return;
    this.clear("tidy"); // a pending tidy would undo the scramble halfway through
    this.run(async (signal) => {
      this.cursor.say("hold on");
      const moves = scrambleMoves(this.wm.currentOrder(), this.wm.letters(), 4);
      await this.perform(moves, signal);
      await this.stepAside(signal);
      this.schedule("tidy", TIDY_AFTER_SCRAMBLE_MS, () => this.tidy());
    });
  }

  tidy() {
    if (this.visitorHolding()) return;
    this.clear("tidy");
    this.run(async (signal) => {
      if (this.wm.word() !== TARGET) {
        this.cursor.say("tidying up");
        const order = this.wm.currentOrder();
        // A parked tile counts as placed; grabbing another one drops it into its gap first.
        await this.perform(solveMoves(order, this.wm.letters()), signal);
      }
      await this.liftToRest(signal);
    });
  }

  // ─── reactions ───────────────────────────────────────────────

  private onVisitorGrab() {
    this.cancel();
    this.clear("tidy", "offer");
    this.cursor.setAway(true);
    // Step off the tile the visitor just took.
    this.run((signal) => this.stepAside(signal));
  }

  private onVisitorDrop(word: string) {
    if (word === TARGET) {
      this.run(async (signal) => {
        this.cursor.say("nice");
        await wait(350, signal);
        await this.liftToRest(signal);
      });
    } else {
      this.schedule("tidy", TIDY_AFTER_MS, () => this.tidy());
    }
  }

  private onCta(entered: boolean) {
    if (this.visitorHolding() || (this.mode === "busy" && entered)) return;
    const cta = this.opts.cta!;
    if (entered) {
      this.run(async (signal) => {
        const r = cta.getBoundingClientRect();
        this.cursor.setAway(true);
        await this.cursor.moveTo(
          { x: r.left + r.width * 0.28, y: r.bottom + 6 },
          { signal, width: r.width },
        );
        this.cursor.say("this one", 6000);
      }, "cta");
    } else if (this.taskName === "cta") {
      this.run((signal) => this.returnHome(signal));
    }
  }

  // ─── tasks ───────────────────────────────────────────────────

  private run(task: Task, name = "") {
    this.cancel();
    const ctrl = new AbortController();
    this.task = ctrl;
    this.taskName = name;
    this.mode = "busy";
    task(ctrl.signal).then(
      () => {
        if (this.task === ctrl) this.task = null;
      },
      (err: unknown) => {
        if (this.task === ctrl) this.task = null;
        if (!isAborted(err) && !ctrl.signal.aborted) throw err;
      },
    );
  }

  private cancel() {
    if (!this.task) return;
    const t = this.task;
    this.task = null;
    // A tile the bot is carrying goes back into the resting pose (or the row if that no longer spells the word).
    if (this.wm.holder() === "bot") this.wm.release("bot", { toRest: true });
    t.abort(new DOMException("superseded", "AbortError"));
  }

  /** Drag tiles through a list of insert-moves. */
  private async perform(moves: Move[], signal: AbortSignal) {
    this.cursor.setAway(true);
    const t = this.wm.tileSize;
    for (const m of moves) {
      await this.cursor.moveTo(this.wm.cursorOnTile(m.tile), {
        signal,
        width: t,
        pauseWhen: this.visitorNear,
      });
      await this.cursor.hold(90, { signal });
      this.wm.grabAsBot(m.tile);
      const onStep = (p: Pt) => this.wm.move("bot", p);
      const target = this.wm.cursorOnSlot(m.to);
      await this.cursor.moveTo(
        { x: target.x, y: target.y - 0.7 * t },
        { signal, width: t, onStep, pauseWhen: this.visitorNear },
      );
      await this.cursor.moveTo(target, { signal, width: t, onStep });
      this.wm.release("bot");
      await this.cursor.hold(140, { signal });
    }
  }

  /** Pick up the tile at REST_INDEX and park it in the logo's mid-drag pose. */
  private async liftToRest(signal: AbortSignal) {
    if (this.wm.word() !== TARGET) return this.stepAside(signal);
    if (!this.wm.isResting()) {
      const id = this.wm.floatingId() ?? this.wm.currentOrder()[REST_INDEX]!;
      this.cursor.setAway(true);
      await this.cursor.moveTo(this.wm.cursorOnTile(id), {
        signal,
        width: this.wm.tileSize,
      });
      await this.cursor.hold(110, { signal });
      this.wm.grabAsBot(id);
      await this.cursor.moveTo(this.wm.restCursor(), {
        signal,
        width: this.wm.tileSize,
        onStep: (p) => this.wm.move("bot", p),
      });
      this.wm.release("bot", { toRest: true });
    }
    this.goHomeNow();
  }

  private async returnHome(signal: AbortSignal) {
    if (!this.wm.isResting()) return this.stepAside(signal);
    await this.cursor.moveTo(this.wm.restCursor(), {
      signal,
      width: this.wm.tileSize,
    });
    this.goHomeNow();
  }

  private goHomeNow() {
    const id = this.wm.floatingId();
    if (id === null || !this.wm.isResting()) return;
    this.mode = "home";
    this.cursor.setAway(false);
    this.cursor.pinTo(() => this.wm.cursorOnTile(id));
  }

  private async stepAside(signal: AbortSignal) {
    this.cursor.setAway(true);
    await this.cursor.moveTo(this.asidePoint(), { signal, width: 60 });
    this.mode = "aside";
  }

  /** Just above the end of the word, watching. */
  private asidePoint(): Pt {
    const t = this.wm.tileSize;
    const last = this.wm.slotCenter(TARGET.length - 1);
    return this.clampToView({ x: last.x + 0.9 * t, y: last.y - 1.3 * t });
  }

  /** Idle visitor: bring them the violet tile. */
  private offer() {
    const p = this.pointer;
    const id = this.wm.floatingId();
    if (!p || id === null || this.mode !== "home" || !this.wm.isResting())
      return;
    this.lastOffer = performance.now();
    this.run(async (signal) => {
      this.cursor.setAway(true);
      this.wm.grabAsBot(id);
      const onStep = (q: Pt) => this.wm.move("bot", q, { retarget: false });
      const t = this.wm.tileSize;
      const near = this.clampToView({ x: p.x - 0.5 * t, y: p.y - 0.4 * t });
      await this.cursor.moveTo(near, { signal, width: 40, onStep });
      this.cursor.say("your move", 4200);
      for (let i = 0; i < 6; i++) {
        const jitter = {
          x: near.x + (Math.random() - 0.5) * 10,
          y: near.y + (Math.random() - 0.5) * 8,
        };
        await this.cursor.moveTo(jitter, { signal, width: 12, onStep });
        await this.cursor.hold(420, { signal, onStep });
      }
      await this.cursor.moveTo(this.wm.restCursor(), {
        signal,
        width: t,
        onStep,
      });
      this.wm.release("bot", { toRest: true });
      this.goHomeNow();
    });
  }

  /** At home, now and then adjust the grip on the tile. */
  private scheduleFidget() {
    if (this.opts.reducedMotion) return;
    this.schedule("fidget", 9000 + Math.random() * 7000, () => {
      const id = this.wm.floatingId();
      if (this.mode === "home" && id !== null && this.wm.isResting()) {
        this.run(async (signal) => {
          this.wm.grabAsBot(id);
          const home = this.wm.restCursor();
          const onStep = (p: Pt) => this.wm.move("bot", p, { retarget: false });
          await this.cursor.moveTo(
            {
              x: home.x + (Math.random() - 0.5) * 8,
              y: home.y - 4 - Math.random() * 5,
            },
            { signal, width: 8, onStep },
          );
          await this.cursor.hold(260, { signal, onStep });
          await this.cursor.moveTo(home, { signal, width: 8, onStep });
          this.wm.release("bot", { toRest: true });
          this.goHomeNow();
        });
      }
      this.scheduleFidget();
    });
  }

  private scheduleOffer() {
    if (!this.opts.finePointer || this.opts.reducedMotion) return;
    this.schedule("offer", OFFER_AFTER_IDLE_MS, () => {
      if (performance.now() - this.lastOffer > OFFER_COOLDOWN_MS) this.offer();
    });
  }

  /** When hanging around, keep a polite distance from the visitor's pointer. */
  private maybeDodge(p: Pt) {
    if (!this.opts.finePointer || this.mode !== "aside") return;
    const now = performance.now();
    const d = dist(p, this.cursor.pos);
    if (d > 110 || now - this.lastDodge < 700) return;
    this.lastDodge = now;
    const away =
      d < 1
        ? { x: 1, y: -1 }
        : {
            x: (this.cursor.pos.x - p.x) / d,
            y: (this.cursor.pos.y - p.y) / d,
          };
    const to = this.clampToView({
      x: this.cursor.pos.x + away.x * 140,
      y: this.cursor.pos.y + away.y * 140,
    });
    this.run(async (signal) => {
      await this.cursor.moveTo(to, { signal, width: 80 });
      this.mode = "aside";
    });
  }

  private visitorNear = () =>
    this.opts.finePointer &&
    !!this.pointer &&
    performance.now() - this.pointerAt < 2000 &&
    dist(this.pointer, this.cursor.pos) < NEAR_PX;

  private visitorHolding() {
    const h = this.wm.holder();
    return h === "user" || h === "key";
  }

  private clampToView(p: Pt): Pt {
    const m = 24;
    return {
      x: Math.min(innerWidth - m, Math.max(m, p.x)),
      y: Math.min(innerHeight - m, Math.max(m, p.y)),
    };
  }

  private schedule(key: string, ms: number, fn: () => void) {
    this.clear(key);
    this.timers.set(key, window.setTimeout(fn, ms));
  }

  private clear(...keys: string[]) {
    for (const k of keys) {
      clearTimeout(this.timers.get(k));
      this.timers.delete(k);
    }
  }
}
