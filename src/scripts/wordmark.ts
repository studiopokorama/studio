import type { Pt } from "./motion";
import { critical, SNAP, Spring, type SpringConfig } from "./spring";
import { REST_INDEX, TARGET } from "./words";

export type Holder = "user" | "bot" | "key";

export type WordmarkEvent =
  | { type: "grab"; id: number; holder: Holder }
  | { type: "drop"; id: number; holder: Holder; word: string; at: Pt }
  | { type: "rest" }
  | { type: "gap" }
  /** Tiles were redrawn (animation frame, resize). */
  | { type: "frame" };

interface Tile {
  id: number;
  letter: string;
  el: HTMLElement;
  x: Spring;
  y: Spring;
  rot: Spring;
  scale: Spring;
}

interface Floating {
  id: number;
  /** null = parked in the brand's resting pose, lifted out of the gap. */
  holder: Holder | null;
  /** Pointer position relative to the tile's top-left when grabbed. */
  grab: Pt;
  from: number;
  vx: number;
  vy: number;
  last: { x: number; y: number; t: number } | null;
}

// Geometry from the 56px reference, expressed as fractions of the tile size.
const REST_OFFSET = { x: 26 / 56, y: -40 / 56 };
/** Where the logo's cursor tip sits on the resting tile. */
const CURSOR_ON_TILE = { x: 43.5 / 56, y: 37.2 / 56 };
const GAP_RATIO = 4 / 56;
const LIFT_ROT = 7;
const LIFT_SCALE = 1.04;
const THROW_LOOKAHEAD = 0.1; // s of release velocity projected onto the drop point

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export class Wordmark {
  private tiles: Tile[];
  private order: number[];
  private floating: Floating | null = null;
  private gap = REST_INDEX;
  private gapX: Spring;
  private size = 56;
  private origin: Pt = { x: 0, y: 0 };
  private raf = 0;
  /** Pointer that grabbed the user-held tile; other fingers are ignored. */
  private activePointer: number | null = null;
  private lastFrame = 0;
  private listeners = new Set<(e: WordmarkEvent) => void>();
  private snap: SpringConfig;
  private follow: SpringConfig;
  private abort = new AbortController();
  private celebrateTimer = 0;

  constructor(
    private row: HTMLElement,
    private gapEl: HTMLElement,
    private reducedMotion: boolean,
  ) {
    this.snap = reducedMotion ? critical(900) : SNAP;
    this.follow = critical(reducedMotion ? 4000 : 1600);
    const els = [...row.querySelectorAll<HTMLElement>("[data-tile]")];
    if (els.length !== TARGET.length)
      throw new Error(`expected ${TARGET.length} tiles, found ${els.length}`);
    this.tiles = els.map((el, id) => ({
      id,
      letter: TARGET[id]!,
      el,
      x: new Spring(0, this.snap),
      y: new Spring(0, this.snap),
      rot: new Spring(0, this.snap),
      scale: new Spring(1, this.snap),
    }));
    this.order = this.tiles.map((t) => t.id);
    this.gapX = new Spring(0, critical(900));
    this.measure();
    this.bindInput();
  }

  // ─── public API ──────────────────────────────────────────────

  on(fn: (e: WordmarkEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get tileSize() {
    return this.size;
  }

  /** Current letters left to right, with a floating tile counted at its gap. */
  word(): string {
    return this.fullOrder()
      .map((id) => this.tiles[id]!.letter)
      .join("");
  }

  currentOrder(): number[] {
    return this.fullOrder();
  }

  letters(): string[] {
    return this.tiles.map((t) => t.letter);
  }

  holder(): Holder | null | undefined {
    return this.floating ? this.floating.holder : undefined;
  }

  floatingId(): number | null {
    return this.floating?.id ?? null;
  }

  isResting(): boolean {
    return (
      !!this.floating &&
      this.floating.holder === null &&
      this.gap === REST_INDEX &&
      this.word() === TARGET
    );
  }

  /** Viewport point where the bot's cursor tip sits when holding tile `id`, from its live position. */
  cursorOnTile(id: number): Pt {
    const t = this.tiles[id]!;
    return this.toViewport({
      x: t.x.value + CURSOR_ON_TILE.x * this.size,
      y: t.y.value + CURSOR_ON_TILE.y * this.size,
    });
  }

  /** Viewport point the bot should drag to so that its tile lands in slot `index`. */
  cursorOnSlot(index: number): Pt {
    return this.toViewport({
      x: this.slotX(index) + CURSOR_ON_TILE.x * this.size,
      y: CURSOR_ON_TILE.y * this.size,
    });
  }

  /** Viewport point of the cursor in the brand's resting pose. */
  restCursor(): Pt {
    const p = this.restPose();
    return this.toViewport({
      x: p.x + CURSOR_ON_TILE.x * this.size,
      y: p.y + CURSOR_ON_TILE.y * this.size,
    });
  }

  slotCenter(index: number): Pt {
    return this.toViewport({
      x: this.slotX(index) + this.size / 2,
      y: this.size / 2,
    });
  }

  /** Bot helper: grab at the logo's cursor spot rather than wherever the pointer is. */
  grabAsBot(id: number) {
    this.grab(id, "bot", this.cursorOnTile(id));
  }

  /** A found word: its tiles hop in a quick wave and stay highlighted for a moment. */
  celebrate(ids: number[], ms = 1800) {
    this.clearCelebration();
    ids.forEach((id, i) => {
      const t = this.tiles[id];
      if (!t) throw new Error(`unknown tile ${id}`);
      t.el.classList.add("is-found");
      if (this.reducedMotion) return;
      window.setTimeout(() => {
        t.y.velocity -= this.size * 7;
        this.kick();
      }, i * 60);
    });
    this.celebrateTimer = window.setTimeout(() => this.clearCelebration(), ms);
  }

  clearCelebration() {
    clearTimeout(this.celebrateTimer);
    for (const t of this.tiles) t.el.classList.remove("is-found");
  }

  grab(id: number, holder: Holder, at: Pt) {
    // Picking a tile up breaks the word, so the highlight goes.
    if (holder !== "bot") this.clearCelebration();
    const f = this.floating;
    // The visitor always wins: their grab drops whatever the bot is carrying. The bot must never steal.
    if (holder === "bot" && f && f.holder !== null && f.holder !== "bot")
      throw new Error(`tile ${f.id} is held by ${f.holder}`);
    if (f && f.id !== id) this.settleFloating();
    const tile = this.tiles[id]!;
    if (!this.floating) {
      const idx = this.order.indexOf(id);
      if (idx === -1) throw new Error(`tile ${id} not in row`);
      this.order.splice(idx, 1);
      this.gap = idx;
      this.gapX.jump(this.slotX(idx));
    }
    const local = this.toLocal(at);
    this.floating = {
      id,
      holder,
      grab: { x: local.x - tile.x.value, y: local.y - tile.y.value },
      from: this.floating?.from ?? this.gap,
      vx: 0,
      vy: 0,
      last: null,
    };
    for (const s of [tile.x, tile.y])
      s.config = holder === "key" ? this.snap : this.follow;
    tile.rot.target = LIFT_ROT;
    tile.scale.target = LIFT_SCALE;
    if (holder === "key") this.placeKeyTile();
    this.render();
    this.emit({ type: "grab", id, holder });
    this.kick();
  }

  /** Follow the holder. With `retarget: false` the gap stays put (the tile is just being carried around). */
  move(holder: Holder, at: Pt, { retarget = true } = {}) {
    const f = this.floating;
    if (!f || f.holder !== holder) return;
    const tile = this.tiles[f.id]!;
    const now = performance.now();
    const local = this.toLocal(at);
    if (f.last) {
      const dt = Math.max(1, now - f.last.t) / 1000;
      // Smoothed pointer velocity (px/s) drives tilt and throw.
      f.vx = f.vx * 0.7 + ((local.x - f.last.x) / dt) * 0.3;
      f.vy = f.vy * 0.7 + ((local.y - f.last.y) / dt) * 0.3;
    }
    f.last = { x: local.x, y: local.y, t: now };

    const want = { x: local.x - f.grab.x, y: local.y - f.grab.y };
    if (retarget) this.updateGap(want);
    // Magnetism: near the open slot, the tile is pulled toward it.
    const slot = { x: this.slotX(this.gap), y: 0 };
    const d = Math.hypot(want.x - slot.x, want.y - slot.y);
    const pull = 0.35 * (1 - smoothstep(0.15 * this.size, 1.3 * this.size, d));
    tile.x.target = want.x + (slot.x - want.x) * pull;
    tile.y.target = want.y + (slot.y - want.y) * pull;
    tile.rot.target = LIFT_ROT + clamp(f.vx * 0.012, -14, 14);
    this.kick();
  }

  /** Drop the held tile. With `toRest`, park it in the brand pose if that spells the word. */
  release(holder: Holder, opts: { toRest?: boolean } = {}) {
    const f = this.floating;
    if (!f || f.holder !== holder) return;
    const tile = this.tiles[f.id]!;
    if (holder === "user" && f.last && performance.now() - f.last.t < 80) {
      // A flick carries the tile on a little, at most ~1.5 slots.
      const reach = 1.5 * this.size;
      this.updateGap({
        x: tile.x.target + clamp(f.vx * THROW_LOOKAHEAD, -reach, reach),
        y: tile.y.target + clamp(f.vy * THROW_LOOKAHEAD, -reach, reach),
      });
    }
    for (const s of [tile.x, tile.y]) s.config = this.snap;
    if (opts.toRest && this.gap === REST_INDEX && this.word() === TARGET) {
      f.holder = null;
      this.poseResting();
      this.emit({ type: "rest" });
    } else {
      const at = this.slotCenter(this.gap);
      this.settleFloating();
      this.emit({ type: "drop", id: tile.id, holder, word: this.word(), at });
    }
    this.kick();
  }

  /** Keyboard: move the held tile's gap left/right. */
  nudge(delta: -1 | 1) {
    const f = this.floating;
    if (!f || f.holder !== "key") return;
    this.setGap(clamp(this.gap + delta, 0, this.order.length));
    this.placeKeyTile();
    this.kick();
  }

  /** Initial drop-in (40ms stagger) and the REST_INDEX tile lifting into its resting pose. */
  async intro(): Promise<void> {
    if (this.reducedMotion) {
      this.order.splice(REST_INDEX, 1);
      this.floating = {
        id: REST_INDEX,
        holder: null,
        grab: { x: 0, y: 0 },
        from: REST_INDEX,
        vx: 0,
        vy: 0,
        last: null,
      };
      this.gap = REST_INDEX;
      this.layout(true);
      for (const t of this.tiles) t.el.classList.add("is-in");
      this.row.classList.add("is-ready");
      this.render();
      this.emit({ type: "rest" });
      return;
    }
    this.layout(true);
    for (const t of this.tiles) t.y.jump(-0.9 * this.size);
    this.row.classList.add("is-ready");
    this.render();
    await Promise.all(
      this.tiles.map(
        (t, i) =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              t.el.classList.add("is-in");
              t.y.target = 0;
              this.kick();
              resolve();
            }, 40 * i),
          ),
      ),
    );
    await wait(420);
    if (this.floating) return; // the visitor got there first
    this.grab(REST_INDEX, "bot", this.cursorOnTile(REST_INDEX));
    this.release("bot", { toRest: true });
    await wait(400);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.celebrateTimer);
    this.abort.abort();
    this.listeners.clear();
  }

  // ─── internals ───────────────────────────────────────────────

  private emit(e: WordmarkEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private fullOrder(): number[] {
    const o = this.order.slice();
    if (this.floating) o.splice(this.gap, 0, this.floating.id);
    return o;
  }

  private slotX(index: number) {
    return index * this.size * (1 + GAP_RATIO);
  }

  private restPose(): Pt {
    return {
      x: this.slotX(REST_INDEX) + REST_OFFSET.x * this.size,
      y: REST_OFFSET.y * this.size,
    };
  }

  private toLocal(p: Pt): Pt {
    return { x: p.x - this.origin.x, y: p.y - this.origin.y };
  }

  private toViewport(p: Pt): Pt {
    return { x: p.x + this.origin.x, y: p.y + this.origin.y };
  }

  private measure() {
    const r = this.row.getBoundingClientRect();
    this.origin = { x: r.left, y: r.top };
    this.size = r.width / (TARGET.length + (TARGET.length - 1) * GAP_RATIO);
  }

  private updateGap(topLeft: Pt) {
    const cy = topLeft.y + this.size / 2;
    if (Math.abs(cy - this.size / 2) > 2.4 * this.size) return; // too far from the row to target it
    const pitch = this.size * (1 + GAP_RATIO);
    this.setGap(clamp(Math.round(topLeft.x / pitch), 0, this.order.length));
  }

  private setGap(index: number) {
    if (index === this.gap) return;
    this.gap = index;
    this.layout();
    this.emit({ type: "gap" });
  }

  private settleFloating() {
    const f = this.floating;
    if (!f) return;
    this.order.splice(this.gap, 0, f.id);
    this.floating = null;
    const tile = this.tiles[f.id]!;
    for (const s of [tile.x, tile.y]) s.config = this.snap;
    this.layout();
  }

  private poseResting() {
    const f = this.floating;
    if (!f) return;
    const tile = this.tiles[f.id]!;
    const p = this.restPose();
    tile.x.target = p.x;
    tile.y.target = p.y;
    tile.rot.target = LIFT_ROT;
    tile.scale.target = 1;
  }

  private placeKeyTile() {
    const f = this.floating;
    if (!f) return;
    const tile = this.tiles[f.id]!;
    tile.x.target = this.slotX(this.gap) + REST_OFFSET.x * this.size * 0.5;
    tile.y.target = REST_OFFSET.y * this.size;
  }

  /** Point every placed tile (and a parked floating tile) at its slot. */
  private layout(jump = false) {
    this.order.forEach((id, i) => {
      const slot = this.floating && i >= this.gap ? i + 1 : i;
      const t = this.tiles[id]!;
      const targets = [
        [t.x, this.slotX(slot)],
        [t.y, 0],
        [t.rot, 0],
        [t.scale, 1],
      ] as const;
      for (const [s, v] of targets) jump ? s.jump(v) : (s.target = v);
    });
    this.gapX.target = this.slotX(this.gap);
    if (this.floating?.holder === null) this.poseResting();
    if (this.floating?.holder === "key") this.placeKeyTile();
    if (jump) {
      this.gapX.jump(this.gapX.target);
      if (this.floating) {
        const t = this.tiles[this.floating.id]!;
        for (const s of [t.x, t.y, t.rot, t.scale]) s.jump(s.target);
      }
    }
    this.kick();
  }

  private render() {
    const floatId = this.floating?.id;
    for (const t of this.tiles) {
      t.el.style.transform = `translate3d(${t.x.value}px, ${t.y.value}px, 0) rotate(${t.rot.value}deg) scale(${t.scale.value})`;
      const lifted = t.id === floatId;
      t.el.classList.toggle("is-lifted", lifted);
      t.el.classList.toggle(
        "is-held",
        lifted && this.floating!.holder !== null,
      );
    }
    this.gapEl.style.transform = `translate3d(${this.gapX.value}px, 0, 0)`;
    this.gapEl.classList.toggle("is-open", !!this.floating);
    this.emit({ type: "frame" });
  }

  private kick() {
    if (this.raf) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    // The rAF timestamp can predate the performance.now() taken in kick(); never step backwards.
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    let moving = false;
    const f = this.floating;
    if (f && f.holder !== null && f.holder !== "key") {
      // Let tilt relax when the pointer stops.
      f.vx *= 0.85;
      this.tiles[f.id]!.rot.target = LIFT_ROT + clamp(f.vx * 0.012, -14, 14);
      moving = Math.abs(f.vx) > 1;
    }
    for (const t of this.tiles) {
      for (const s of [t.x, t.y, t.rot, t.scale]) moving = s.step(dt) || moving;
    }
    moving = this.gapX.step(dt) || moving;
    this.render();
    this.raf = moving ? requestAnimationFrame(this.frame) : 0;
  };

  private bindInput() {
    const signal = this.abort.signal;
    const remeasure = () => {
      const before = this.size;
      this.measure();
      if (before !== this.size) this.layout(true);
      this.render();
    };
    new ResizeObserver(remeasure).observe(this.row);
    window.addEventListener("resize", remeasure, { signal });
    window.addEventListener(
      "scroll",
      () => {
        this.measure();
        this.render(); // keeps the fixed-position bot cursor pinned to the tile
      },
      { signal, passive: true },
    );

    for (const t of this.tiles) {
      const el = t.el;
      el.addEventListener(
        "pointerdown",
        (e) => {
          if (
            e.button !== 0 ||
            this.floating?.holder === "user" ||
            this.floating?.holder === "key"
          )
            return;
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          this.activePointer = e.pointerId;
          this.grab(t.id, "user", { x: e.clientX, y: e.clientY });
        },
        { signal },
      );
      el.addEventListener(
        "pointermove",
        (e) => {
          if (e.pointerId === this.activePointer)
            this.move("user", { x: e.clientX, y: e.clientY });
        },
        { signal },
      );
      const end = (e: PointerEvent) => {
        if (e.pointerId !== this.activePointer) return;
        this.activePointer = null;
        this.release("user");
      };
      el.addEventListener("pointerup", end, { signal });
      el.addEventListener("pointercancel", end, { signal });
      el.addEventListener("lostpointercapture", end, { signal });

      el.addEventListener(
        "keydown",
        (e) => {
          const held =
            this.floating?.holder === "key" && this.floating.id === t.id;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (held) this.release("key");
            else if (this.floating?.holder !== "user")
              this.grab(t.id, "key", this.cursorOnTile(t.id));
          } else if (
            held &&
            (e.key === "ArrowLeft" || e.key === "ArrowRight")
          ) {
            e.preventDefault();
            this.nudge(e.key === "ArrowLeft" ? -1 : 1);
          } else if (held && e.key === "Escape") {
            e.preventDefault();
            this.setGap(this.floating!.from);
            this.release("key");
          }
        },
        { signal },
      );
      // Focus moving away drops a keyboard-held tile where it is, so it can't stay stuck in the air.
      el.addEventListener(
        "blur",
        () => {
          if (this.floating?.holder === "key" && this.floating.id === t.id)
            this.release("key");
        },
        { signal },
      );
    }
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
