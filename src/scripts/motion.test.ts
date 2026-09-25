import { describe, expect, it } from "vitest";
import { dist, fittsDuration, minJerk, planMove, sampleStroke } from "./motion";
import { Spring } from "./spring";

describe("minJerk", () => {
  it("starts at 0, ends at 1, is monotonic and clamps", () => {
    expect(minJerk(0)).toBe(0);
    expect(minJerk(1)).toBe(1);
    expect(minJerk(0.5)).toBeCloseTo(0.5);
    expect(minJerk(-1)).toBe(0);
    expect(minJerk(2)).toBe(1);
    for (let t = 0; t < 1; t += 0.05)
      expect(minJerk(t + 0.05)).toBeGreaterThanOrEqual(minJerk(t));
  });
});

describe("fittsDuration", () => {
  it("grows with distance and shrinks with target size, within bounds", () => {
    expect(fittsDuration(600, 40)).toBeGreaterThan(fittsDuration(100, 40));
    expect(fittsDuration(300, 80)).toBeLessThan(fittsDuration(300, 20));
    expect(fittsDuration(0, 40)).toBeGreaterThanOrEqual(140);
    expect(fittsDuration(1e6, 1)).toBeLessThanOrEqual(1150);
  });
});

describe("planMove", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 500, y: 200 };

  it("always ends exactly on the target", () => {
    for (let seed = 0; seed < 50; seed++) {
      let s = seed;
      const rng = () => (s = (s * 9301 + 49297) % 233280) / 233280;
      const strokes = planMove(from, to, 40, rng);
      expect(strokes.length).toBeGreaterThan(0);
      const last = strokes.at(-1)!;
      expect(sampleStroke(last, 1)).toEqual(to);
      expect(sampleStroke(strokes[0]!, 0)).toEqual(from);
      for (let i = 1; i < strokes.length; i++)
        expect(strokes[i]!.from).toEqual(strokes[i - 1]!.to);
    }
  });

  it("overshoots then corrects when rng says so", () => {
    const strokes = planMove(from, to, 40, () => 0.1);
    expect(strokes).toHaveLength(2);
    expect(dist(from, strokes[0]!.to)).toBeGreaterThan(dist(from, to));
  });

  it("returns nothing for a zero-length move", () => {
    expect(planMove(from, from, 40)).toEqual([]);
  });
});

describe("Spring", () => {
  it("settles on target and overshoots when underdamped", () => {
    const s = new Spring(0);
    s.target = 100;
    let max = 0;
    for (let i = 0; i < 240 && s.step(1 / 60); i++)
      max = Math.max(max, s.value);
    expect(s.value).toBe(100);
    expect(max).toBeGreaterThan(100);
  });
});
