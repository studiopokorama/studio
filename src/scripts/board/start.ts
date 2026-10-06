import { createBoard } from "./index";
import type { Board } from "./types";

/**
 * The background board on `canvas`, or null without WebGL. The board is decoration: on failure
 * the page falls back to the CSS pattern (html.no-gl), but the error is still logged.
 */
export function startBoard(
  canvas: HTMLCanvasElement,
  reducedMotion: boolean,
): Board | null {
  try {
    const board = createBoard(canvas, { reducedMotion });
    if (!board) document.documentElement.classList.add("no-gl");
    return board;
  } catch (err) {
    console.error("board: WebGL init failed, using CSS fallback", err);
    document.documentElement.classList.add("no-gl");
    return null;
  }
}
