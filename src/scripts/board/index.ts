import type { Board } from "./types";
import {
  clampDpr,
  hexToRgb01,
  packRipples,
  rippleSlot,
  smoothToward,
  toGlY,
  type Ripple,
} from "./math";
import { FRAGMENT_SHADER, MAX_RIPPLES, VERTEX_SHADER } from "./shader";

export type { Board } from "./types";
export { hexToRgb01 } from "./math";

export interface BoardOptions {
  reducedMotion: boolean;
}

const COLORS = {
  u_bg: "#121115",
  u_line: "#3A3842",
  u_stripe: "#1C1B21",
  u_hover: "#5A5766",
  u_violet: "#9B7BF5",
} as const;

// Smoothing rates (1/s) and settle thresholds.
const POINTER_RATE = 14;
const POINTER_EPS = 0.25; // CSS px
const FACTOR_RATE = 8;
const FACTOR_EPS = 0.002;
const PROGRESS_RATE = 1.6; // slow, so newly lit slots visibly fade in
const FLASH_MS = 1500;

const UNIFORMS = [
  "u_size",
  "u_scale",
  "u_pointer",
  "u_prox",
  "u_drag",
  "u_progress",
  "u_flash",
  "u_ripples",
  ...Object.keys(COLORS),
] as const;
type UniformName = (typeof UNIFORMS)[number];

interface GlResources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  loc: Record<UniformName, WebGLUniformLocation | null>;
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("board: createShader failed");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new Error(`board: shader compile failed: ${log}`);
  }
  return shader;
}

function buildResources(gl: WebGLRenderingContext): GlResources {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("board: createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.linkProgram(program);
  // Shaders are no longer needed once linked (or failed).
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "";
    gl.deleteProgram(program);
    throw new Error(`board: program link failed: ${log}`);
  }

  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("board: createBuffer failed");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // Fullscreen triangle.
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.useProgram(program);
  const loc = {} as Record<UniformName, WebGLUniformLocation | null>;
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);
  for (const [name, hex] of Object.entries(COLORS)) {
    gl.uniform3fv(loc[name as UniformName], hexToRgb01(hex));
  }
  return { program, buffer, loc };
}

/** Returns null when WebGL is unavailable. Throws if the shaders fail to build. */
export function createBoard(
  canvas: HTMLCanvasElement,
  opts: BoardOptions,
): Board | null {
  const ctx = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  if (!ctx) return null;
  const gl: WebGLRenderingContext = ctx;

  const reduced = opts.reducedMotion;
  let res: GlResources | null = buildResources(gl);

  // Viewport size in CSS px and the actual device-px-per-CSS-px ratio.
  let cssW = 1;
  let cssH = 1;
  let scale = 1;

  const target = { x: 0, y: 0, prox: 0, drag: 0, progress: 0 };
  const current = { x: 0, y: 0, prox: 0, drag: 0, progress: 0 };
  const ripples: (Ripple | null)[] = new Array<Ripple | null>(MAX_RIPPLES).fill(
    null,
  );
  const rippleData = new Float32Array(MAX_RIPPLES * 4);

  let raf = 0;
  let lastTime = 0;
  let flashStart = -Infinity;
  let destroyed = false;

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    const dpr = clampDpr(window.devicePixelRatio);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    scale = w / cssW;
  }

  function isSettled(): boolean {
    return (
      current.x === target.x &&
      current.y === target.y &&
      current.prox === target.prox &&
      current.drag === target.drag &&
      current.progress === target.progress
    );
  }

  function step(dt: number): void {
    if (reduced) {
      Object.assign(current, target);
      return;
    }
    current.x = smoothToward(
      current.x,
      target.x,
      dt,
      POINTER_RATE,
      POINTER_EPS,
    );
    current.y = smoothToward(
      current.y,
      target.y,
      dt,
      POINTER_RATE,
      POINTER_EPS,
    );
    current.prox = smoothToward(
      current.prox,
      target.prox,
      dt,
      FACTOR_RATE,
      FACTOR_EPS,
    );
    current.drag = smoothToward(
      current.drag,
      target.drag,
      dt,
      FACTOR_RATE,
      FACTOR_EPS,
    );
    current.progress = smoothToward(
      current.progress,
      target.progress,
      dt,
      PROGRESS_RATE,
      FACTOR_EPS,
    );
  }

  /** Draws one frame; returns the number of live ripples. */
  function draw(now: number): number {
    const flashing = now - flashStart <= FLASH_MS;
    const alive =
      packRipples(ripples, now, cssH, rippleData) + (flashing ? 1 : 0);
    if (!res || gl.isContextLost()) return alive;
    const { loc } = res;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(loc.u_size, cssW, cssH);
    gl.uniform1f(loc.u_scale, scale);
    gl.uniform2f(loc.u_pointer, current.x, toGlY(current.y, cssH));
    gl.uniform1f(loc.u_prox, current.prox);
    gl.uniform1f(loc.u_drag, current.drag);
    gl.uniform1f(loc.u_progress, current.progress);
    const flash = (now - flashStart) / FLASH_MS;
    gl.uniform1f(loc.u_flash, flash >= 0 && flash <= 1 ? flash : -1);
    gl.uniform4fv(loc.u_ripples, rippleData);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return alive;
  }

  function frame(now: number): void {
    raf = 0;
    // Clamp dt so a long gap (tab switch, jank) doesn't produce a jump.
    const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
    lastTime = now;
    step(dt);
    const alive = draw(now);
    if (alive > 0 || !isSettled()) schedule();
    else lastTime = 0;
  }

  function schedule(): void {
    if (raf || destroyed || !res || document.hidden) return;
    if (!lastTime) lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastTime = 0;
  }

  function redraw(): void {
    if (destroyed) return;
    resize();
    const alive = draw(performance.now());
    if (alive > 0 || !isSettled()) schedule();
  }

  const onVisibility = (): void => {
    if (document.hidden) stop();
    else redraw();
  };

  const onContextLost = (e: Event): void => {
    e.preventDefault();
    stop();
    res = null; // Resources died with the context.
  };

  const onContextRestored = (): void => {
    if (destroyed) return;
    res = buildResources(gl);
    redraw();
  };

  const ro = new ResizeObserver(redraw);
  ro.observe(canvas);
  // DPR changes (zoom, moving between screens) fire resize but not ResizeObserver.
  window.addEventListener("resize", redraw);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  redraw();

  return {
    setPointer(p) {
      if (destroyed) return;
      if (p) {
        // Coming back from rest: jump to the pointer instead of sliding from a stale spot.
        if (current.prox === 0) {
          current.x = p.x;
          current.y = p.y;
        }
        target.x = p.x;
        target.y = p.y;
        target.prox = 1;
      } else {
        target.prox = 0;
      }
      schedule();
    },
    setDragging(dragging) {
      if (destroyed) return;
      target.drag = dragging ? 1 : 0;
      schedule();
    },
    flash() {
      if (destroyed || reduced) return;
      flashStart = performance.now();
      schedule();
    },
    setProgress(fraction) {
      if (destroyed) return;
      if (!Number.isFinite(fraction))
        throw new Error(`board: bad progress ${fraction}`);
      target.progress = Math.min(Math.max(fraction, 0), 1);
      schedule();
    },
    ripple(x, y, strength = 1) {
      if (destroyed || reduced) return;
      const s = Math.min(Math.max(strength, 0), 1);
      if (!(s > 0)) return;
      const now = performance.now();
      ripples[rippleSlot(ripples, now)] = { x, y, start: now, strength: s };
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      ro.disconnect();
      window.removeEventListener("resize", redraw);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (res && !gl.isContextLost()) {
        gl.deleteBuffer(res.buffer);
        gl.deleteProgram(res.program);
      }
      res = null;
    },
  };
}
