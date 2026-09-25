import { describe, expect, it } from "vitest";
import {
  clampDpr,
  hexToRgb01,
  packRipples,
  RIPPLE_LIFETIME,
  rippleEnvelope,
  rippleSlot,
  smoothToward,
  toGlY,
  type Ripple,
} from "./math";
import { FRAGMENT_SHADER, MAX_RIPPLES } from "./shader";

describe("hexToRgb01", () => {
  it("parses 6-digit hex with or without #", () => {
    expect(hexToRgb01("#9B7BF5")).toEqual([155 / 255, 123 / 255, 245 / 255]);
    expect(hexToRgb01("121115")).toEqual([18 / 255, 17 / 255, 21 / 255]);
  });

  it("expands 3-digit hex", () => {
    expect(hexToRgb01("#fff")).toEqual([1, 1, 1]);
  });

  it("throws on invalid input", () => {
    expect(() => hexToRgb01("#12345")).toThrow(/Invalid hex/);
    expect(() => hexToRgb01("violet")).toThrow(/Invalid hex/);
  });
});

describe("clampDpr", () => {
  it("caps at 2 and defaults bad values to 1", () => {
    expect(clampDpr(3)).toBe(2);
    expect(clampDpr(1.5)).toBe(1.5);
    expect(clampDpr(0)).toBe(1);
    expect(clampDpr(Number.NaN)).toBe(1);
  });
});

describe("smoothToward", () => {
  it("moves part of the way and never overshoots", () => {
    const v = smoothToward(0, 100, 1 / 60, 14, 0.25);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
  });

  it("is frame-rate independent", () => {
    let a = 0;
    for (let i = 0; i < 2; i++) a = smoothToward(a, 100, 1 / 120, 14, 0);
    const b = smoothToward(0, 100, 1 / 60, 14, 0);
    expect(a).toBeCloseTo(b, 10);
  });

  it("snaps to target within eps so the loop can settle", () => {
    expect(smoothToward(99.9, 100, 1 / 60, 14, 0.25)).toBe(100);
  });

  it("does not move with dt = 0", () => {
    expect(smoothToward(10, 100, 0, 14, 0.001)).toBe(10);
  });
});

describe("rippleEnvelope", () => {
  it("starts at 1, decays, and is 0 outside its lifetime", () => {
    expect(rippleEnvelope(0)).toBe(1);
    expect(rippleEnvelope(0.5)).toBeLessThan(rippleEnvelope(0.1));
    expect(rippleEnvelope(RIPPLE_LIFETIME)).toBe(0);
    expect(rippleEnvelope(-0.1)).toBe(0);
  });
});

describe("toGlY", () => {
  it("flips y against viewport height", () => {
    expect(toGlY(0, 800)).toBe(800);
    expect(toGlY(800, 800)).toBe(0);
  });
});

describe("packRipples", () => {
  const out = () => new Float32Array(MAX_RIPPLES * 4);

  it("packs live ripples with flipped y, age and scaled amplitude", () => {
    const r: Ripple = { x: 10, y: 100, start: 1000, strength: 0.5 };
    const data = out();
    const alive = packRipples([r], 1500, 800, data);
    expect(alive).toBe(1);
    expect(data[0]).toBe(10);
    expect(data[1]).toBe(700);
    expect(data[2]).toBeCloseTo(0.5);
    expect(data[3]).toBeCloseTo(rippleEnvelope(0.5) * 0.5);
    expect(Array.from(data.slice(4))).toEqual(new Array(20).fill(0));
  });

  it("zeroes expired ripples", () => {
    const data = out().fill(9);
    const r: Ripple = { x: 1, y: 1, start: 0, strength: 1 };
    expect(packRipples([r], RIPPLE_LIFETIME * 1000 + 1, 800, data)).toBe(0);
    expect(Array.from(data)).toEqual(new Array(24).fill(0));
  });
});

describe("rippleSlot", () => {
  const at = (start: number): Ripple => ({ x: 0, y: 0, start, strength: 1 });

  it("uses the first empty slot", () => {
    expect(rippleSlot([at(0), null, at(0)], 10)).toBe(1);
  });

  it("reuses an expired slot", () => {
    expect(rippleSlot([at(5000), at(0), at(5000)], 5100)).toBe(1);
  });

  it("replaces the oldest when all are alive", () => {
    const ripples = [at(300), at(100), at(200)];
    expect(rippleSlot(ripples, 400)).toBe(1);
  });
});

describe("fragment shader", () => {
  it("declares a ripple array matching MAX_RIPPLES", () => {
    expect(FRAGMENT_SHADER).toContain(`#define MAX_RIPPLES ${MAX_RIPPLES}`);
    expect(FRAGMENT_SHADER).toContain("uniform vec4 u_ripples[MAX_RIPPLES]");
  });
});
