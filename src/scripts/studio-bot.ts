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

/** Distance the cursor and its label keep from the viewport edges (px). */
const VIEW_MARGIN = 16;
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
  /** Every word found: the word stays whole and the bot admires it until reset. */
  private completed = false;
  private task: AbortController | null = null;
  /** Kept after the task finishes so the CTA leave can tell whether the bot is still pointing at it. */
  private taskName = "";
  private pointer: Pt | null = null;
  private pointerAt = 0;
  private lastOffer = -Infinity;
  private timers = new Map<string, number>();
  private lastDodge = 0;
  /** What the visitor's pointer is on right now, so the bot can get there once it's free. */
  private hovered: { el: HTMLElement; say: string } | null = null;

  constructor(
    private wm: Wordmark,
    private cursor: BotCursor,
    private opts: {
      reducedMotion: boolean;
      finePointer: boolean;
      /** Buttons the cursor points at when hovered, with what it says there. */
      ctas: { el: HTMLElement; say: string }[];
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
    for (const cta of opts.ctas) {
      cta.el.addEventListener("pointerenter", () => this.point(cta));
      cta.el.addEventListener("pointerleave", () => this.point(null));
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
    if (this.visitorHolding() || this.completed) return;
    this.clear("tidy"); // a pending tidy would undo the scramble halfway through
    this.run(async (signal) => {
      this.cursor.say("hold on");
      const moves = scrambleMoves(this.wm.currentOrder(), this.wm.letters(), 4);
      await this.perform(moves, signal);
      await this.stepAside(signal);
      this.schedule("tidy", TIDY_AFTER_SCRAMBLE_MS, () => this.tidy());
    });
  }

  /**
   * Every word found: put the word together, drop the violet tile into its slot so the logo is
   * whole for a moment (`celebrate` runs then), and lift it back out. Always a work in progress.
   */
  /** True from the start of the finale until reset: the word is finished and stays whole. */
  get done() {
    return this.completed;
  }

  /**
   * Every word found. `leadIn` runs first (the replay), then the bot puts the word together and
   * drops the violet tile into its slot so the logo is whole (`celebrate` runs then), and from then
   * on admires it until reset. Scramble and tidy are refused from the moment this is called.
   */
  finale(leadIn: () => Promise<void>, celebrate: () => Promise<void>) {
    // Called from the visitor's own drop, so nothing can be held; if it is, the state is broken.
    if (this.visitorHolding())
      throw new Error("finale started while the visitor holds a tile");
    this.completed = true;
    this.clear("tidy", "offer");
    this.run(async (signal) => {
      await leadIn();
      this.cursor.setAway(true);
      if (this.wm.word() !== TARGET) {
        this.cursor.say("one sec");
        await this.perform(
          solveMoves(this.wm.currentOrder(), this.wm.letters()),
          signal,
        );
      }
      const id = this.wm.floatingId();
      if (id !== null) {
        const t = this.wm.tileSize;
        await this.cursor.moveTo(this.wm.cursorOnTile(id), {
          signal,
          width: t,
        });
        this.wm.grabAsBot(id);
        const slot = this.wm.cursorOnSlot(this.wm.currentOrder().indexOf(id));
        await this.cursor.moveTo(slot, {
          signal,
          width: t,
          onStep: (p) => this.wm.move("bot", p),
        });
        this.wm.release("bot");
      }
      this.cursor.say("done", 2600);
      this.cursor.setIdleLabel("thanks for playing");
      await celebrate();
      await wait(1600, signal);
      await this.admire(signal);
    });
  }

  /** Back to the beginning: lift the violet tile out again and carry on as usual. */
  reset() {
    this.completed = false;
    this.cursor.setIdleLabel();
    this.clear("tidy", "offer");
    this.run((signal) => this.liftToRest(signal));
  }

  tidy() {
    if (this.visitorHolding() || this.completed) return;
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

  /** Hovering a button or a project: point at it (`null` = the pointer left it). */
  point(cta: { el: HTMLElement; say: string } | null) {
    if (!this.opts.finePointer || this.opts.reducedMotion) return;
    this.hovered = cta;
    if (this.visitorHolding()) return;
    // Pointing, or on the way back from pointing: a new hover takes over either way.
    const pointing = this.taskName === "cta" || this.taskName === "cta-home";
    if (cta) {
      this.clear("cta-leave");
      // Busy with real work (tidying, the finale): finish it first; `run` comes back for the hover.
      if (this.mode === "busy" && !pointing) return;
      this.pointAt(cta);
    } else if (pointing) {
      // A short grace period, so moving straight onto the next button keeps pointing.
      this.schedule("cta-leave", 150, () => {
        if (this.taskName === "cta")
          this.run((signal) => this.returnHome(signal), "cta-home");
      });
    }
  }

  private pointAt(cta: { el: HTMLElement; say: string }) {
    this.run(async (signal) => {
      const r = cta.el.getBoundingClientRect();
      // Point from below, or from above when the label wouldn't fit under it (the footer).
      const flip =
        r.bottom + 6 + this.cursor.labelExtent(false).bottom >
        innerHeight - VIEW_MARGIN;
      this.cursor.setFlipped(flip);
      this.cursor.setAway(true);
      await this.cursor.moveTo(
        this.clampToView({
          x: r.left + r.width * 0.28,
          y: flip ? r.top - 6 : r.bottom + 6,
        }),
        { signal, width: r.width },
      );
      this.cursor.say(cta.say, 6000);
    }, "cta");
  }

  // ─── tasks ───────────────────────────────────────────────────

  private run(task: Task, name = "") {
    this.cancel();
    this.cursor.setFlipped(false); // only pointing flips it, and only for its own move
    const ctrl = new AbortController();
    this.task = ctrl;
    this.taskName = name;
    this.mode = "busy";
    task(ctrl.signal).then(
      () => {
        if (this.task !== ctrl) return;
        this.task = null;
        // A hover that came in while the bot was busy.
        const h = this.hovered;
        if (h && !name.startsWith("cta") && !this.visitorHolding())
          this.pointAt(h);
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

  /**
   * The finished word, admired: read along it tapping each tile (a small hop), then step back
   * and look at it for a while. Loops until reset. With reduced motion it just steps back.
   */
  private async admire(signal: AbortSignal) {
    this.cursor.setAway(true);
    const t = this.wm.tileSize;
    if (this.opts.reducedMotion) {
      await this.cursor.moveTo(this.asidePoint(), { signal, width: 60 });
      return;
    }
    for (;;) {
      for (const [i, id] of this.wm.currentOrder().entries()) {
        const c = this.wm.slotCenter(i);
        await this.cursor.moveTo(
          { x: c.x + 0.2 * t, y: c.y + 0.25 * t },
          { signal, width: t, pauseWhen: this.visitorNear },
        );
        await this.cursor.hold(80, { signal });
        this.wm.poke(id);
      }
      await this.cursor.moveTo(this.asidePoint(), { signal, width: 60 });
      await wait(4500 + Math.random() * 2500, signal);
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
    this.cursor.setFlipped(false);
    this.cursor.setAway(false);
    this.cursor.hush(); // back on the logo: no label, whatever was said on the way
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

  /** Keep the cursor, and its label (below-right, or above-right when flipped), fully on screen. */
  private clampToView(p: Pt): Pt {
    const m = VIEW_MARGIN;
    const label = this.cursor.labelExtent();
    return {
      x: Math.min(innerWidth - m - label.right, Math.max(m, p.x)),
      y: Math.min(innerHeight - m - label.bottom, Math.max(m + label.top, p.y)),
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
