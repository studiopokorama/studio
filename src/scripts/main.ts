import { CONTACT_EMAIL } from "../config";
import { createBoard } from "./board";
import type { Board } from "./board/types";
import { BotCursor } from "./cursor";
import { createPalette } from "./palette";
import { Sound } from "./sound";
import { StudioBot } from "./studio-bot";
import { Wordmark } from "./wordmark";
import { FoundBoard } from "./found-board";
import {
  Launcher,
  originOf,
  ProjectOverlay,
  type Origin,
} from "./project-overlay";
import { bindTile, Showcase } from "./showcase";
import { findHiddenWord, HIDDEN_WORDS, TARGET } from "./words";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function need<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}

function initBoard(reducedMotion: boolean): Board | null {
  try {
    const board = createBoard(need<HTMLCanvasElement>("[data-board]"), {
      reducedMotion,
    });
    if (!board) document.documentElement.classList.add("no-gl");
    return board;
  } catch (err) {
    // The board is decoration: fall back to the CSS pattern, but keep the failure visible.
    console.error("board: WebGL init failed, using CSS fallback", err);
    document.documentElement.classList.add("no-gl");
    return null;
  }
}

async function init() {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

  const board = initBoard(reducedMotion);
  const wm = new Wordmark(
    need("[data-row]"),
    need("[data-gap]"),
    reducedMotion,
  );
  const cursor = new BotCursor(
    need("[data-bot]"),
    need("[data-bot-label]"),
    reducedMotion,
  );
  const bot = new StudioBot(wm, cursor, {
    reducedMotion,
    finePointer,
    ctas: [
      { el: need<HTMLElement>("[data-cta]"), say: "free demo" },
      { el: need<HTMLElement>("[data-contact]"), say: "friendly humans" },
      ...[...document.querySelectorAll<HTMLElement>(".apps-btn")].map((el) => ({
        el,
        say: "all projects",
      })),
    ],
  });
  const sound = new Sound();
  const caption = need<HTMLElement>("[data-caption]");
  const found = new Set<string>();
  // Tight bounds of the visible content, not its full-width boxes, so found words can use the free board.
  const textRect = (sel: string) => {
    const range = document.createRange();
    range.selectNodeContents(need(sel));
    return range.getBoundingClientRect();
  };
  const widen = (r: DOMRect, minWidth: number) =>
    new DOMRect(r.x, r.y, Math.max(r.width, minWidth), r.height);
  /** The page content: the wordmark row first (found words gather around it). */
  const contentRects = () => {
    const row = need("[data-row]").getBoundingClientRect();
    const lifted = wm.tileSize; // the resting tile and the cursor rise above the row
    return [
      new DOMRect(
        row.x,
        row.y - lifted,
        row.width + lifted,
        row.height + lifted,
      ),
      textRect(".wm-studio"),
      // The caption's text changes as words are found; reserve room for the longest line.
      widen(textRect("[data-caption]"), 520),
      textRect(".lede"),
      // The whole header band, edge to edge: nothing sits up among the buttons or against the top.
      need(".top").getBoundingClientRect(),
      textRect(".foot"),
    ];
  };
  const showcaseEl = document.querySelector<HTMLElement>("[data-showcase]");
  const showcase = showcaseEl
    ? new Showcase(showcaseEl, {
        reducedMotion,
        finePointer,
        obstacles: contentRects,
        // Beside the lede, in the middle of the space right of it.
        anchor: () => {
          const lede = textRect(".lede");
          return {
            x: (lede.left + showcaseEl.clientWidth) / 2,
            y: lede.top + lede.height / 2,
          };
        },
      })
    : null;
  const foundBoard = new FoundBoard(
    need("[data-found]"),
    () => [...contentRects(), ...(showcase?.rects() ?? [])],
    reducedMotion,
  );
  // Tiles first: the found words then settle around them.
  const relayout = () => {
    showcase?.layout();
    foundBoard.relayout();
  };
  let relayoutFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(relayoutFrame);
    relayoutFrame = requestAnimationFrame(relayout);
  });
  // The layers are fixed but the content can scroll on short screens: lay out again once it settles.
  let scrollTimer = 0;
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(relayout, 150);
    },
    { passive: true },
  );

  wm.on((e) => {
    if (e.type === "grab") {
      // Drop-target glow is for the visitor; it follows their pointer.
      board?.setDragging(e.holder !== "bot");
      if (!bot.fidgeting) sound.lift(); // the idle nudge stays silent
    } else if (e.type === "drop") {
      board?.setDragging(false);
      board?.ripple(e.at.x, e.at.y, e.holder === "bot" ? 0.55 : 1);
      if (!bot.fidgeting) sound.snap(e.holder === "bot" ? 0.4 : 0.7);
      if (e.holder !== "bot") onVisitorDrop(e.word);
    } else if (e.type === "rest") {
      board?.setDragging(false);
    }
  });

  function onVisitorDrop(word: string) {
    if (word === TARGET) {
      caption.textContent = "Back in place.";
      return;
    }
    const hit = findHiddenWord(word, found);
    if (!hit) return;
    const isNew = !found.has(hit);
    if (isNew) {
      // Only a first find is celebrated; a repeat just gets the caption.
      const start = word.indexOf(hit);
      wm.celebrate(wm.currentOrder().slice(start, start + hit.length));
      sound.reward();
    }
    found.add(hit);
    const total = HIDDEN_WORDS.length;
    if (isNew) {
      board?.setProgress(found.size / total);
      const at = foundBoard.add(hit);
      if (at) board?.ripple(at.x, at.y, 0.45);
      if (found.size === total) finale();
    }
    caption.textContent =
      found.size === total
        ? `All ${total} words found. You are a legend.`
        : isNew
          ? `You found “${hit}”. ${found.size} of ${total}.`
          : `“${hit}” again. ${found.size} of ${total} found.`;
  }

  /** Every word found: replay the words, then the bot closes the logo with a wave and a chord. */
  function finale() {
    wm.setLocked(true); // the word is finished: it stays whole until reset
    const leadIn = async () => {
      await sleep(reducedMotion ? 0 : 900); // let the last word's own highlight land first
      await foundBoard.replay(1500, (i, n) =>
        sound.note(n > 1 ? i / (n - 1) : 1),
      );
    };
    bot.finale(leadIn, async () => {
      const ids = wm.currentOrder();
      wm.celebrate(ids, 2600);
      if (!reducedMotion)
        ids.forEach((_, i) => setTimeout(() => sound.tick(i * 2), i * 60));
      board?.flash();
      await sleep(reducedMotion ? 0 : ids.length * 60 + 120);
      sound.chord();
      await sleep(1200);
      resetBtn.hidden = false;
    });
  }

  const resetBtn = need<HTMLButtonElement>("[data-reset]");
  const startCaption = caption.textContent?.trim() ?? "";
  /** Back to the beginning: no words found, empty board, the violet tile lifted out again. */
  function reset() {
    found.clear();
    foundBoard.reset();
    board?.setProgress(0);
    caption.textContent = startCaption;
    wm.setLocked(false);
    bot.reset();
    resetBtn.hidden = true;
  }
  resetBtn.addEventListener("click", reset);

  // ─── projects ────────────────────────────────────────────────

  const center = (r: DOMRect) => ({
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
  });
  const overlayEl = document.querySelector<HTMLDialogElement>("[data-overlay]");
  const overlay = overlayEl
    ? new ProjectOverlay(overlayEl, {
        reducedMotion,
        home: (id) => showcase?.card(id) ?? null,
        onOpen: (id: string, from: Origin | null) => {
          showcase?.setOpen(id);
          bot.setPointer(null); // the cursor waits behind the overlay
          if (from) {
            sound.lift();
            const c = center(from.rect);
            board?.ripple(c.x, c.y, 0.8);
          }
        },
        onClose: (_id, landed) => {
          showcase?.setOpen(null);
          if (landed) {
            sound.snap(0.6);
            const c = center(landed.getBoundingClientRect());
            board?.ripple(c.x, c.y, 0.8);
          }
        },
      })
    : null;
  const launcherEl =
    document.querySelector<HTMLDialogElement>("[data-launcher]");
  const launcher = launcherEl
    ? new Launcher(launcherEl, {
        reducedMotion,
        onPick: (id, from) => overlay?.open(id, from),
      })
    : null;
  for (const app of launcherEl?.querySelectorAll<HTMLElement>(
    "[data-project]",
  ) ?? []) {
    bindTile(app, { reducedMotion, finePointer });
    const warm = () => overlay?.warm(app.dataset.project ?? "");
    app.addEventListener("pointerenter", warm);
    app.addEventListener("focus", warm);
  }
  for (const btn of document.querySelectorAll("[data-launcher-open]"))
    btn.addEventListener("click", () => {
      sound.tick(4);
      launcher?.open();
    });
  for (const tile of showcase?.tiles ?? []) {
    tile.addEventListener("click", (e) => {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const card = showcase?.card(tile.dataset.project ?? "");
      if (!overlay || !card) return;
      e.preventDefault();
      bot.point(null);
      overlay.open(tile.dataset.project!, originOf(card));
    });
    const warm = () => overlay?.warm(tile.dataset.project ?? "");
    tile.addEventListener("pointerenter", warm);
    tile.addEventListener("focus", warm);
    const cta = { el: tile, say: "take a look" };
    tile.addEventListener("pointerenter", () => bot.point(cta));
    tile.addEventListener("pointerleave", () => bot.point(null));
  }
  const inProject = () => !!overlay?.isOpen || !!launcher?.isOpen;

  const onPointer = (e: PointerEvent) => {
    const p = { x: e.clientX, y: e.clientY };
    board?.setPointer(p);
    if (e.pointerType !== "touch" && !inProject()) bot.setPointer(p);
  };
  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("pointerdown", onPointer, { passive: true });
  window.addEventListener(
    "pointerup",
    (e) => e.pointerType === "touch" && board?.setPointer(null),
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", () => {
    board?.setPointer(null);
    bot.setPointer(null);
  });

  // Capture phase: unlock audio before the tile's own pointerdown plays its first sound.
  const unlockAudio = () => sound.unlock();
  window.addEventListener("pointerdown", unlockAudio, { capture: true });
  window.addEventListener("keydown", unlockAudio, { capture: true });

  const soundBtn = need<HTMLButtonElement>("[data-sound]");
  const setSound = (on: boolean) => {
    sound.toggle(on);
    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.textContent = on ? "Sound on" : "Sound off";
    return on;
  };
  soundBtn.addEventListener("click", () => setSound(!sound.enabled));

  const palette = createPalette(need("[data-palette]"), [
    {
      name: "contact",
      hint: "email the studio",
      run: () => {
        location.href = `mailto:${CONTACT_EMAIL}`;
        return [`Opening your email app for ${CONTACT_EMAIL}.`];
      },
    },
    {
      name: "scramble",
      hint: "mix up the tiles",
      run: () => {
        if (bot.done)
          return ["Every word is found. Press Reset to play again."];
        bot.scramble();
        return { close: true };
      },
    },
    {
      name: "tidy",
      hint: "put the tiles back",
      run: () => {
        if (bot.done) return ["It's already tidy. Press Reset to play again."];
        bot.tidy();
        return { close: true };
      },
    },
    {
      name: "words",
      hint: "hidden words you've found",
      run: () =>
        found.size
          ? [
              `${found.size} of ${HIDDEN_WORDS.length}: ${[...found].join(", ")}`,
            ]
          : [
              `None yet. ${HIDDEN_WORDS.length} words are hidden in the tiles. Rearrange them to find one.`,
            ],
    },
    {
      name: "next",
      hint: "a word you haven't found yet",
      run: () => {
        const next = HIDDEN_WORDS.find((w) => !found.has(w));
        return next
          ? [`Try spelling “${next}”.`]
          : [`You've found all ${HIDDEN_WORDS.length} words.`];
      },
    },
    ...(launcher
      ? [
          {
            name: "projects",
            hint: "see everything we've made",
            run: () => {
              launcher.open();
              return { close: true } as const;
            },
          },
        ]
      : []),
    {
      name: "sound",
      hint: "turn tile sounds on or off",
      run: () => [setSound(!sound.enabled) ? "Sound on." : "Sound off."],
    },
    {
      name: "clear",
      hint: "clear this log",
      run: () => {
        need("[data-palette-log]").replaceChildren();
        return [];
      },
    },
  ]);
  need("[data-palette-open]").addEventListener("click", palette.open);

  if (import.meta.env.DEV)
    Object.assign(window, {
      __pokorama: { wm, bot, board, foundBoard, showcase, overlay, launcher },
    });

  await wm.intro();
  bot.start();
  if (showcase) {
    await document.fonts.ready; // the tiles steer around the text, so measure it in its final font
    relayout();
    showcase.intro((at) => board?.ripple(at.x, at.y, 0.5));
  }
}

init().catch((err: unknown) => {
  // Without JS the tiles would stay hidden; show the static resting pose instead.
  document.documentElement.classList.remove("js");
  throw err;
});
