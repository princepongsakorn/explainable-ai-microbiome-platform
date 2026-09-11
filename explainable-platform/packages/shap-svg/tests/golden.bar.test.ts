import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseExplanation } from "../src/core/parse";
import { globalImportance, orderFeatures } from "../src/core/order";
import { collapseToDisplay } from "../src/core/collapse";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

describe.each(["tiny", "real"])("bar golden values — %s", (name) => {
  const explanation = load(`${name}.json`);
  const golden = load(`${name}.bar.golden.json`);

  const parsed = parseExplanation(explanation);
  const importance = globalImportance(parsed);
  const order = orderFeatures(importance);
  const { rows } = collapseToDisplay(
    parsed.featureNames, importance, order, golden.max_display, true,
  );

  it("produces the same row labels as SHAP", () => {
    expect(rows.map((r) => r.label)).toEqual(golden.labels);
  });

  // The golden file stores what SHAP drew, rounded to four significant figures by
  // the capture script (spec 1.4). Round our value the same way before comparing —
  // the renderer itself must stay full-precision so that a caller passing raw
  // shap.Explanation values gets them back untouched.
  const toGoldenPrecision = (v: number) => Number(v.toPrecision(4));

  it("produces the same bar lengths as SHAP", () => {
    rows.forEach((row, i) => {
      expect(toGoldenPrecision(row.value)).toBeCloseTo(golden.values[i], 10);
    });
  });

  it("does not round inside the renderer", () => {
    // A value that survived toPrecision(4) unchanged would hide the bug this guards.
    const unrounded = rows.map((r) => r.value).find((v) => v !== toGoldenPrecision(v));
    expect(unrounded).toBeDefined();
  });
});

describe("edge cases render without throwing", () => {
  const edge = load("edge.json");
  it.each(Object.keys(edge))("%s", (key) => {
    const parsed = parseExplanation(edge[key]);
    const importance = globalImportance(parsed);
    const order = orderFeatures(importance);
    expect(() => collapseToDisplay(parsed.featureNames, importance, order, 10, false)).not.toThrow();
  });
});
