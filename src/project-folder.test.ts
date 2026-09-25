import { describe, expect, it } from "vitest";
import {
  compareProjects,
  findSlugClash,
  folderOf,
  parseFolder,
} from "./project-folder";

describe("parseFolder", () => {
  it("splits the order from the slug", () => {
    expect(parseFolder("4-tidewater")).toEqual({ order: 4, slug: "tidewater" });
    expect(parseFolder("12-ledger-lite")).toEqual({
      order: 12,
      slug: "ledger-lite",
    });
  });

  it("accepts a folder without a number", () => {
    expect(parseFolder("night-bus")).toEqual({
      order: null,
      slug: "night-bus",
    });
  });

  it("rejects names that can't be a URL slug", () => {
    expect(() => parseFolder("4-Tide Water")).toThrow(/4-Tide Water/);
    expect(() => parseFolder("4-")).toThrow();
  });
});

describe("folderOf", () => {
  it("returns the folder holding index.md", () => {
    expect(folderOf("src/content/projects/4-tidewater/index.md")).toBe(
      "4-tidewater",
    );
  });

  it("rejects other files", () => {
    expect(() =>
      folderOf("src/content/projects/4-tidewater/cover.jpg"),
    ).toThrow();
  });
});

describe("compareProjects", () => {
  it("lists the highest number first, then unnumbered by newest year", () => {
    const list = [
      { name: "a", order: 1, year: 2026 },
      { name: "b", order: null, year: 2024 },
      { name: "c", order: 3, year: 2020 },
      { name: "d", order: null, year: 2025 },
    ];
    expect(list.sort(compareProjects).map((p) => p.name)).toEqual([
      "c",
      "a",
      "d",
      "b",
    ]);
  });
});

describe("findSlugClash", () => {
  it("finds two folders with the same slug", () => {
    expect(
      findSlugClash(["2-tidewater", "3-night-bus", "5-tidewater"]),
    ).toEqual(["2-tidewater", "5-tidewater"]);
  });

  it("returns null when every slug is unique", () => {
    expect(findSlugClash(["2-tidewater", "night-bus"])).toBeNull();
  });
});
