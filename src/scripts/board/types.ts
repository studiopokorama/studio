/** Public API of the background board (see board/index.ts). Coordinates are CSS pixels in viewport space. */
export interface Board {
  /** Latest visitor pointer position; null when the pointer left the window or on touch release. */
  setPointer(p: { x: number; y: number } | null): void;
  /** True while any tile is being dragged: nearby slots read as drop targets (violet hint instead of neutral). */
  setDragging(dragging: boolean): void;
  /** Share of hidden words found, 0..1: that share of slots gets a violet outline, spreading from the top-left corner. */
  setProgress(fraction: number): void;
  /** A bright violet wave across the whole board, from the top-left corner (the finale). */
  flash(): void;
  /** A tile landed at (x, y). strength 0..1 scales the ripple. */
  ripple(x: number, y: number, strength?: number): void;
  destroy(): void;
}
