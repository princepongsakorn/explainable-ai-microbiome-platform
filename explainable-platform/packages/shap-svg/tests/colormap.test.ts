import { describe, expect, it } from "vitest";
import { sampleColormap } from "../src/core/colormap";

describe("sampleColormap", () => {
  it("returns the captured end colours and clamps values outside the domain", () => {
    expect(sampleColormap("red_blue", 0)).toBe("#008bfb");
    expect(sampleColormap("red_blue", 1)).toBe("#ff0051");
    expect(sampleColormap("red_blue", -1)).toBe("#008bfb");
    expect(sampleColormap("red_blue", 2)).toBe("#ff0051");
  });

  it("linearly interpolates RGB channels between adjacent captured entries", () => {
    // Halfway between LUT entries 127 (#9b24ae) and 128 (#9c23ad).
    expect(sampleColormap("red_blue", 127.5 / 255)).toBe("#9c24ae");
  });

  it("rejects a non-finite position", () => {
    expect(() => sampleColormap("red_blue", Number.NaN)).toThrow(/finite/);
  });
});
