import { SITE_NAME } from "../config";
import { fitGrid } from "./showcase-layout";

interface ProjectRef {
  id: string;
  title: string;
  path: string;
}

/** Where the overlay flies in from: a rect on screen showing the project's cover. */
export interface Origin {
  rect: DOMRect;
  src: string;
}

const FLY_MS = 460;
const LEAVE_MS = 260;
const SWITCH_MS = 160;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** A drag this far (px) along the main image moves to the next/previous item. */
const SWIPE_PX = 40;
/** Movement (px) before a press on the main image counts as a drag rather than a click. */
const DRAG_START_PX = 6;

/** The image a card is showing right now (the hover preview may be on another shot). */
export function originOf(card: HTMLElement): Origin {
  const img =
    card.querySelector<HTMLImageElement>("img.is-shown") ??
    card.querySelector<HTMLImageElement>("img");
  if (!img) throw new Error("project card without an image");
  return { rect: card.getBoundingClientRect(), src: img.currentSrc || img.src };
}

/**
 * The full-screen project view. Each project has its own URL (/work/<slug>/): opening pushes it,
 * closing goes back, and landing on one directly starts with it open over the home page.
 */
export class ProjectOverlay {
  private projects: ProjectRef[];
  private current: string | null = null;
  /** True when opening added a history entry, so closing should go back rather than replace. */
  private pushed = false;
  private busy = false;
  private body: HTMLElement;
  private frame: HTMLElement;
  private nav: HTMLElement;
  private gallery: AbortController | null = null;

  constructor(
    private dialog: HTMLDialogElement,
    private opts: {
      reducedMotion: boolean;
      /** The card to fly back into on close, if the project is on the board. */
      home: (id: string) => HTMLElement | null;
      onOpen: (id: string, from: Origin | null) => void;
      /** `landed` is the card the view flew back into, if any. */
      onClose: (id: string, landed: HTMLElement | null) => void;
    },
  ) {
    this.projects = JSON.parse(dialog.dataset.projects ?? "[]");
    this.body = need(dialog, "[data-body]");
    this.frame = need(dialog, "[data-frame]");
    this.nav = need(dialog, "[data-nav]");

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault(); // Esc: close with the animation and the history step
      this.close();
    });
    dialog.addEventListener("click", (e) => {
      const a = (e.target as Element).closest<HTMLAnchorElement>(
        "[data-close], [data-prev], [data-next]",
      );
      if (!a || !plainClick(e)) return;
      e.preventDefault();
      if (a.hasAttribute("data-close")) this.close();
      else {
        const id = a.dataset.id;
        if (id) this.switchTo(id, a.hasAttribute("data-next") ? 1 : -1);
      }
    });
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if ((e.target as Element).closest("input, textarea, iframe")) return;
      e.preventDefault();
      this.stepMedia(e.key === "ArrowRight" ? 1 : -1);
    });
    window.addEventListener("popstate", () => {
      this.pushed = false;
      this.sync();
    });

    // Landed on /work/<slug>/: the server rendered the view open (non-modal, for no-JS). Make it modal.
    if (dialog.open) {
      const view = this.body.querySelector<HTMLElement>("[data-view]");
      dialog.close();
      if (view?.dataset.view) {
        this.current = view.dataset.view;
        dialog.showModal();
        this.bindView(view);
        this.opts.onOpen(this.current, null);
      }
    }
  }

  get isOpen() {
    return this.current !== null;
  }

  private syncPending = false;

  /** Show what the URL says (back/forward). Mid-animation, catch up once the animation ends. */
  private sync() {
    if (this.busy) {
      this.syncPending = true;
      return;
    }
    const id = this.idFromPath(location.pathname);
    if (id) {
      if (id !== this.current) this.open(id, null, { push: false });
    } else if (this.current) void this.dismiss();
  }

  private settled() {
    this.busy = false;
    if (this.syncPending) {
      this.syncPending = false;
      this.sync();
    }
  }

  private warmed = new Set<string>();

  /**
   * Fetch and decode a project's cover at stage size ahead of time (on hover or focus), so the
   * first open doesn't stall mid-flight while the big image arrives.
   */
  warm(id: string) {
    if (this.warmed.has(id)) return;
    this.warmed.add(id);
    const src =
      this.template(id)?.content.querySelector<HTMLImageElement>(
        "img[data-cover]",
      );
    if (!src) return;
    const img = new Image();
    img.sizes = src.sizes;
    img.srcset = src.srcset;
    img.src = src.src;
    img.decode().catch((err: unknown) => {
      this.warmed.delete(id); // try again next time
      console.warn(`project ${id}: cover preload failed`, err);
    });
  }

  private template(id: string) {
    return document.querySelector<HTMLTemplateElement>(
      `template[data-view-template="${CSS.escape(id)}"]`,
    );
  }

  /** Open a project, flying its cover in from `from` when given. */
  open(id: string, from: Origin | null, { push = true } = {}) {
    const ref = this.ref(id);
    if (this.current) {
      this.switchTo(id, 0, push);
      return;
    }
    const view = this.render(ref);
    this.current = id;
    this.dialog.showModal();
    this.bindView(view);
    if (push) {
      history.pushState({ project: id }, "", ref.path);
      this.pushed = true;
    }
    this.opts.onOpen(id, from);
    this.frame.scrollTop = 0;
    if (this.opts.reducedMotion) return;
    this.dialog.classList.remove("is-leaving");
    this.replayEntrance();
    const cover = view.querySelector<HTMLElement>("[data-stage]");
    if (from && cover) void this.fly(from, cover, "in");
  }

  /** Close with a history step: back when the open added one, else replace the URL with the home page. */
  close() {
    if (!this.current || this.busy) return;
    if (this.pushed && history.state?.project === this.current) {
      history.back(); // popstate dismisses
    } else {
      history.replaceState(null, "", "/");
      void this.dismiss();
    }
  }

  private async dismiss() {
    const id = this.current;
    if (!id || this.busy) return;
    this.busy = true;
    this.pushed = false;
    const home = this.opts.home(id);
    const stage = this.body.querySelector<HTMLElement>("[data-stage]");
    if (!this.opts.reducedMotion) {
      this.dialog.classList.add("is-leaving");
      if (home && stage && this.dialog.open) {
        const shown = stage.querySelector<HTMLElement>(
          "[data-item]:not([hidden])",
        );
        const img = shown?.querySelector("img");
        // A playing video has no image to carry back: just fade.
        if (img && !shown?.querySelector("iframe"))
          await this.fly(
            {
              rect: stage.getBoundingClientRect(),
              src: img.currentSrc || img.src,
            },
            home,
            "out",
          );
        else await new Promise((r) => setTimeout(r, LEAVE_MS));
      } else {
        await new Promise((r) => setTimeout(r, LEAVE_MS));
      }
    }
    this.stopGallery();
    this.dialog.close();
    this.dialog.classList.remove("is-leaving");
    this.body.replaceChildren();
    this.current = null;
    document.title = SITE_NAME;
    this.opts.onClose(id, home);
    this.settled();
  }

  /** Swap to another project while open. `dir` slides the new view in from that side (0: fade). */
  private async switchTo(id: string, dir: number, push = true) {
    if (id === this.current || this.busy) return;
    const ref = this.ref(id);
    this.busy = true;
    if (!this.opts.reducedMotion) {
      this.body.style.setProperty("--dir", String(dir));
      this.body.classList.add("is-switching");
      await new Promise((r) => setTimeout(r, SWITCH_MS));
    }
    const view = this.render(ref);
    this.current = id;
    this.bindView(view);
    // Prev/next and the launcher replace the entry: back still closes the overlay.
    if (push) history.replaceState({ project: id }, "", ref.path);
    this.frame.scrollTop = 0;
    this.body.classList.remove("is-switching");
    if (!this.opts.reducedMotion) this.replayEntrance();
    this.opts.onOpen(id, null);
    this.settled();
  }

  private render(ref: ProjectRef): HTMLElement {
    const view = this.template(ref.id)?.content.firstElementChild?.cloneNode(
      true,
    );
    if (!(view instanceof HTMLElement))
      throw new Error(`no view for project ${ref.id}`);
    this.stopGallery();
    this.body.replaceChildren(view);
    return view;
  }

  /** Title, prev/next and the gallery for the view now in the body. */
  private bindView(view: HTMLElement) {
    const id = view.dataset.view!;
    const ref = this.ref(id);
    document.title = `${ref.title} | ${SITE_NAME}`;
    this.dialog.setAttribute("aria-labelledby", `pv-${id}`);
    const i = this.projects.indexOf(ref);
    const n = this.projects.length;
    this.nav.hidden = n < 2;
    const link = (sel: string, target: ProjectRef) => {
      const a = need<HTMLAnchorElement>(this.nav, sel);
      a.href = target.path;
      a.dataset.id = target.id;
      need(a, "[data-label]").textContent = target.title;
    };
    link("[data-prev]", this.projects[(i - 1 + n) % n]!);
    link("[data-next]", this.projects[(i + 1) % n]!);
    this.bindGallery(view);
  }

  // ─── gallery ─────────────────────────────────────────────────

  /** Show item `i`; `dir` slides it in from that side (1: from the right, -1: left, 0: fade). */
  private selectMedia: ((i: number, dir: number) => void) | null = null;
  private mediaIndex = 0;
  private mediaCount = 0;

  private bindGallery(view: HTMLElement) {
    this.gallery = new AbortController();
    const signal = this.gallery.signal;
    const items = [...view.querySelectorAll<HTMLElement>("[data-item]")];
    const thumbs = [...view.querySelectorAll<HTMLElement>("[data-thumb]")];
    const stage = need(view, "[data-stage]");
    this.mediaIndex = 0;
    this.mediaCount = items.length;
    const strip = view.querySelector<HTMLElement>(".pv-thumbs");
    if (strip) dragScroll(strip, signal);
    this.selectMedia = (i, dir) => {
      this.mediaIndex = i;
      stage.style.setProperty("--slide", String(dir));
      items.forEach((item, j) => {
        if (j !== i) stopVideo(item);
        item.hidden = j !== i;
      });
      thumbs.forEach((t, j) => t.setAttribute("aria-pressed", String(j === i)));
      if (strip && thumbs[i])
        revealThumb(strip, thumbs[i], this.opts.reducedMotion);
    };
    thumbs.forEach((t, j) =>
      t.addEventListener(
        "click",
        () => this.selectMedia?.(j, Math.sign(j - this.mediaIndex)),
        { signal },
      ),
    );
    // Steam-style loop: the active thumb's progress bar is the timer (CSS, so hovering pauses
    // it); when it fills, move on. Playing a video stops the loop for good (.is-still).
    const media = need(view, ".pv-media");
    if (this.opts.reducedMotion || items.length < 2)
      media.classList.add("is-still");
    thumbs.forEach((t) =>
      t.addEventListener(
        "animationend",
        (e) => {
          if (e.animationName === "pv-progress") this.stepMedia(1);
        },
        { signal },
      ),
    );
    view.addEventListener(
      "click",
      (e) => {
        const play = (e.target as Element).closest<HTMLElement>("[data-play]");
        const item = play?.closest<HTMLElement>("[data-youtube]");
        if (play && item) {
          media.classList.add("is-still");
          playVideo(item);
        }
      },
      { signal },
    );
    // Drag the main image sideways (mouse or touch) to go to the next/previous item.
    let drag: {
      id: number;
      x: number;
      y: number;
      dx: number;
      moved: boolean;
    } | null = null;
    let dragged = false; // swallow the click that ends a drag (e.g. on a video's play button)
    const shown = () => items[this.mediaIndex]!;
    stage.addEventListener(
      "pointerdown",
      (e) => {
        if (
          e.button !== 0 ||
          items.length < 2 ||
          shown().querySelector("iframe")
        )
          return;
        drag = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          dx: 0,
          moved: false,
        };
      },
      { signal },
    );
    stage.addEventListener(
      "pointermove",
      (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x;
        if (!drag.moved) {
          if (Math.abs(dx) < DRAG_START_PX) return;
          // Mostly vertical: a page scroll on touch screens, not ours.
          if (Math.abs(e.clientY - drag.y) > Math.abs(dx)) {
            drag = null;
            return;
          }
          drag.moved = true;
          stage.setPointerCapture(e.pointerId);
          media.classList.add("is-dragging");
        }
        drag.dx = dx;
        // Far enough to switch on release: the uncovered chevron lights up.
        stage.classList.toggle("is-armed", Math.abs(dx) > SWIPE_PX);
        const el = shown();
        el.style.transition = "none";
        el.style.transform = `translateX(${dx}px)`;
      },
      { signal },
    );
    const endDrag = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { dx, moved } = drag;
      drag = null;
      if (!moved) return;
      dragged = true;
      media.classList.remove("is-dragging");
      stage.classList.remove("is-armed");
      const el = shown();
      if (e.type === "pointerup" && Math.abs(dx) > SWIPE_PX) {
        el.style.transition = "";
        el.style.transform = "";
        this.stepMedia(dx < 0 ? 1 : -1);
      } else {
        el.style.transition = "transform 220ms var(--sp-ease-out)";
        el.style.transform = "";
      }
    };
    stage.addEventListener("pointerup", endDrag, { signal });
    stage.addEventListener("pointercancel", endDrag, { signal });
    stage.addEventListener(
      "click",
      (e) => {
        if (!dragged) return;
        dragged = false;
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true, signal },
    );
    stage.addEventListener("pointerdown", () => (dragged = false), { signal });
    stage.addEventListener("dragstart", (e) => e.preventDefault(), { signal });
  }

  private stepMedia(d: number) {
    if (!this.selectMedia || this.mediaCount < 2) return;
    this.selectMedia(
      (this.mediaIndex + d + this.mediaCount) % this.mediaCount,
      Math.sign(d),
    );
  }

  private stopGallery() {
    this.gallery?.abort();
    this.gallery = null;
    this.selectMedia = null;
  }

  // ─── motion ──────────────────────────────────────────────────

  private replayEntrance() {
    this.dialog.classList.remove("is-entering");
    void this.dialog.offsetWidth; // restart the CSS animations
    this.dialog.classList.add("is-entering");
  }

  /**
   * Fly the cover between a card and the stage. The flying copy lives inside the dialog, since
   * a modal dialog sits in the top layer above everything else on the page.
   */
  private async fly(from: Origin, to: HTMLElement, dir: "in" | "out") {
    const target = to.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "po-fly";
    const img = document.createElement("img");
    img.src = from.src;
    img.alt = "";
    ghost.append(img);
    this.dialog.append(ghost);
    to.classList.add("is-covered");
    const box = (r: DOMRect, radius: number) => ({
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      borderRadius: `${radius}px`,
    });
    const anim = ghost.animate(
      [
        box(from.rect, dir === "in" ? 12 : 20),
        box(target, dir === "in" ? 20 : 12),
      ],
      { duration: FLY_MS, easing: EASE, fill: "forwards" },
    );
    try {
      await anim.finished;
    } catch {
      // Cancelled (the dialog closed mid-flight): nothing left to land.
    }
    to.classList.remove("is-covered");
    ghost.remove();
  }

  private ref(id: string): ProjectRef {
    const ref = this.projects.find((p) => p.id === id);
    if (!ref) throw new Error(`unknown project ${id}`);
    return ref;
  }

  private idFromPath(path: string): string | null {
    return this.projects.find((p) => p.path === path)?.id ?? null;
  }
}

/** Space kept between the launcher sheet and the viewport edges (px). */
const SHEET_MARGIN = 16;

/** The "All projects" sheet: every project as a tile, as big as the viewport allows. */
export class Launcher {
  constructor(
    private dialog: HTMLDialogElement,
    private opts: {
      reducedMotion: boolean;
      onPick: (id: string, from: Origin) => void;
    },
  ) {
    dialog.addEventListener("click", (e) => {
      const target = e.target as Element;
      if (target === dialog || target.closest("[data-launcher-close]")) {
        this.close();
        return;
      }
      const app = target.closest<HTMLAnchorElement>("a[data-project]");
      if (!app || !plainClick(e)) return;
      e.preventDefault();
      const from = originOf(need(app, "[data-card]"));
      this.close({ instant: true });
      this.opts.onPick(app.dataset.project!, from);
    });
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
    window.addEventListener("resize", () => {
      if (this.dialog.open) this.fit();
    });
  }

  get isOpen() {
    return this.dialog.open;
  }

  open() {
    if (this.dialog.open) return;
    this.dialog.classList.remove("is-closing");
    this.dialog.showModal();
    this.fit();
  }

  /** Size the grid so it fills the space above the button without scrolling. */
  private fit() {
    const grid = need(this.dialog, ".launcher-grid");
    const head = need(this.dialog, ".launcher-head");
    const cs = getComputedStyle(this.dialog);
    const px = (v: string) => parseFloat(v) || 0;
    const headH = head.offsetHeight + px(getComputedStyle(head).marginBottom);
    const width =
      innerWidth - SHEET_MARGIN * 2 - px(cs.paddingLeft) - px(cs.paddingRight);
    // The sheet is anchored at the bottom (`bottom` in the CSS); it may grow up to the top margin.
    const height =
      innerHeight -
      px(cs.bottom) -
      SHEET_MARGIN -
      px(cs.paddingTop) -
      px(cs.paddingBottom) -
      headH;
    const g = fitGrid({
      count: grid.children.length,
      width,
      height,
      gap: px(getComputedStyle(grid).rowGap),
      min: 120,
      max: 420,
    });
    this.dialog.style.setProperty("--cols", String(g.cols));
    this.dialog.style.setProperty("--cell", `${g.cell}px`);
    this.dialog.classList.toggle("is-scroll", !g.fits);
  }

  close({ instant = false } = {}) {
    if (!this.dialog.open) return;
    if (instant || this.opts.reducedMotion) {
      this.dialog.close();
      return;
    }
    this.dialog.classList.add("is-closing");
    setTimeout(() => {
      this.dialog.close();
      this.dialog.classList.remove("is-closing");
    }, 180);
  }
}

/** A thumbnail strip runs down the side in portrait mode, across otherwise. */
const isColumn = (strip: HTMLElement) =>
  getComputedStyle(strip).flexDirection === "column";

/** Scroll the thumbnail strip (only the strip, along its own axis) just enough to show `thumb`. */
function revealThumb(strip: HTMLElement, thumb: HTMLElement, instant: boolean) {
  const col = isColumn(strip);
  const s = strip.getBoundingClientRect();
  const t = thumb.getBoundingClientRect();
  const [start, end, sStart, sEnd] = col
    ? [t.top, t.bottom, s.top, s.bottom]
    : [t.left, t.right, s.left, s.right];
  const pad = 8;
  const by =
    start < sStart ? start - sStart - pad : end > sEnd ? end - sEnd + pad : 0;
  if (!by) return;
  const behavior = instant ? "auto" : "smooth";
  strip.scrollBy(col ? { top: by, behavior } : { left: by, behavior });
}

/**
 * Drag a scrolling thumbnail strip with the mouse, along its axis (touch already scrolls it
 * natively). A drag doesn't also click the thumbnail it ends on.
 */
function dragScroll(strip: HTMLElement, signal: AbortSignal) {
  let drag: {
    id: number;
    at: number;
    from: number;
    col: boolean;
    moved: boolean;
  } | null = null;
  let dragged = false;
  strip.addEventListener(
    "pointerdown",
    (e) => {
      dragged = false;
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const col = isColumn(strip);
      const overflows = col
        ? strip.scrollHeight > strip.clientHeight
        : strip.scrollWidth > strip.clientWidth;
      if (!overflows) return;
      drag = {
        id: e.pointerId,
        at: col ? e.clientY : e.clientX,
        from: col ? strip.scrollTop : strip.scrollLeft,
        col,
        moved: false,
      };
    },
    { signal },
  );
  strip.addEventListener(
    "pointermove",
    (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = (drag.col ? e.clientY : e.clientX) - drag.at;
      if (!drag.moved) {
        if (Math.abs(d) < DRAG_START_PX) return;
        drag.moved = true;
        strip.setPointerCapture(e.pointerId);
        strip.classList.add("is-dragging");
      }
      if (drag.col) strip.scrollTop = drag.from - d;
      else strip.scrollLeft = drag.from - d;
    },
    { signal },
  );
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    dragged = drag.moved;
    drag = null;
    strip.classList.remove("is-dragging");
  };
  strip.addEventListener("pointerup", end, { signal });
  strip.addEventListener("pointercancel", end, { signal });
  strip.addEventListener(
    "click",
    (e) => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    },
    { capture: true, signal },
  );
  strip.addEventListener("dragstart", (e) => e.preventDefault(), { signal });
}

function playVideo(item: HTMLElement) {
  const id = item.dataset.youtube;
  const poster = item.querySelector("[data-play]");
  if (!id || !poster) return;
  const frame = document.createElement("iframe");
  frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1`;
  frame.title = "YouTube video";
  frame.allow =
    "autoplay; encrypted-media; picture-in-picture; fullscreen; web-share";
  frame.allowFullscreen = true;
  (item as HTMLElement & { poster?: Element }).poster = poster;
  poster.replaceWith(frame);
  frame.focus();
}

/** Back to the poster: removing the iframe stops playback. */
function stopVideo(item: HTMLElement) {
  const frame = item.querySelector("iframe");
  const poster = (item as HTMLElement & { poster?: Element }).poster;
  if (frame && poster) frame.replaceWith(poster);
}

/** A click that should stay in the page (not a new tab or window). */
export function plainClick(e: MouseEvent) {
  return !(e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}

function need<T extends HTMLElement = HTMLElement>(
  root: ParentNode,
  sel: string,
): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}
