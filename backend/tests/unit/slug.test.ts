import { describe, expect, it } from "vitest";
import { slugify, slugWithSuffix } from "../../src/lib/slug.js";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("Analytical Engines")).toBe("analytical-engines");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Acme, Inc.!!")).toBe("acme-inc");
  });

  it("trims surrounding separators", () => {
    expect(slugify("  --Hello World--  ")).toBe("hello-world");
  });

  it("returns an empty string when there is nothing usable", () => {
    expect(slugify("   ")).toBe("");
  });
});

describe("slugWithSuffix", () => {
  it("appends a suffix", () => {
    expect(slugWithSuffix("Acme", "ab12")).toBe("acme-ab12");
  });

  it("falls back to workspace when the base is empty", () => {
    expect(slugWithSuffix("!!!", "ab12")).toBe("workspace-ab12");
  });
});
