import { describe, expect, it } from "vitest";
import {
  applyMove,
  findHiddenWord,
  HIDDEN_WORDS,
  scrambleMoves,
  solveMoves,
  TARGET,
} from "./words";

const LETTERS = [...TARGET];
const spell = (order: number[]) => order.map((id) => LETTERS[id]).join("");
const run = (order: number[], moves: { tile: number; to: number }[]) =>
  moves.reduce(applyMove, order);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("hidden words", () => {
  it("only lists words spellable from the target's letters", () => {
    const count = (s: string) =>
      [...s].reduce<Record<string, number>>(
        (m, c) => ((m[c] = (m[c] ?? 0) + 1), m),
        {},
      );
    const available = count(TARGET);
    for (const w of HIDDEN_WORDS) {
      for (const [ch, n] of Object.entries(count(w)))
        expect(n, w).toBeLessThanOrEqual(available[ch] ?? 0);
    }
  });

  it("only lists words of four letters or more", () => {
    for (const w of HIDDEN_WORDS) expect(w.length, w).toBeGreaterThanOrEqual(4);
  });

  it("skips words already visible in the target", () => {
    for (const w of HIDDEN_WORDS) expect(TARGET.includes(w), w).toBe(false);
  });

  it("finds the longest word in a row", () => {
    expect(findHiddenWord("pokarmao")).toBe("karma");
    expect(findHiddenWord("oakpromo")).toBe("promo");
    expect(findHiddenWord("pokorama")).toBe(null);
  });

  it("prefers a word not found yet over one already found", () => {
    // "pramokoa" holds both pram and amok (same length).
    expect(findHiddenWord("pramokoa", new Set(["amok"]))).toBe("pram");
    expect(findHiddenWord("pramokoa", new Set(["pram"]))).toBe("amok");
    // A shorter new word beats a longer found one: "parkaoom" holds parka and park.
    expect(findHiddenWord("parkaoom")).toBe("parka");
    expect(findHiddenWord("parkaoom", new Set(["parka"]))).toBe("park");
  });
});

describe("applyMove", () => {
  it("removes then inserts", () => {
    expect(applyMove([0, 1, 2, 3], { tile: 0, to: 3 })).toEqual([1, 2, 3, 0]);
    expect(applyMove([0, 1, 2, 3], { tile: 3, to: 0 })).toEqual([3, 0, 1, 2]);
  });
  it("rejects unknown tiles and bad targets", () => {
    expect(() => applyMove([0, 1], { tile: 5, to: 0 })).toThrow();
    expect(() => applyMove([0, 1], { tile: 0, to: 2 })).toThrow();
  });
});

describe("solveMoves", () => {
  it("does nothing when already solved", () => {
    expect(solveMoves([0, 1, 2, 3, 4, 5, 6, 7], LETTERS)).toEqual([]);
  });

  it("treats equal letters as interchangeable", () => {
    // The two o's (1, 3) and two a's (5, 7) swapped still spell the word.
    expect(solveMoves([0, 3, 2, 1, 4, 7, 6, 5], LETTERS)).toEqual([]);
  });

  it("fixes a single displaced tile in one move", () => {
    const order = [2, 0, 1, 3, 4, 5, 6, 7];
    const moves = solveMoves(order, LETTERS);
    expect(moves).toHaveLength(1);
    expect(spell(run(order, moves))).toBe(TARGET);
  });

  it("solves random scrambles with the minimum number of moves", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 300; i++) {
      const order = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => rng() - 0.5);
      const moves = solveMoves(order, LETTERS);
      expect(spell(run(order, moves))).toBe(TARGET);
      // Lower bound check: a single move can never be dropped.
      for (let skip = 0; skip < moves.length; skip++) {
        const partial = moves.filter((_, j) => j !== skip);
        let ok = true;
        try {
          ok = spell(run(order, partial)) === TARGET;
        } catch {
          ok = false;
        }
        expect(ok).toBe(false);
      }
    }
  });
});

describe("scrambleMoves", () => {
  it("never produces the target", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const moves = scrambleMoves([0, 1, 2, 3, 4, 5, 6, 7], LETTERS, 4, rng);
      expect(moves).toHaveLength(4);
      expect(spell(run([0, 1, 2, 3, 4, 5, 6, 7], moves))).not.toBe(TARGET);
    }
  });
});
