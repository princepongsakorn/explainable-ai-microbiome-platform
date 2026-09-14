# shap-svg: core + bar chart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-free core of `shap-svg` plus its first chart — a global bar chart of mean(|SHAP value|) — verified against arrays captured from SHAP itself.

**Architecture:** A `core/` layer that knows nothing about React: parse and validate an Explanation payload, compute global importance, order Features, collapse to displayed rows, and produce pure layout geometry. A `react/` layer that is a thin component over that geometry. Correctness is established by golden-value tests whose expected arrays were captured by monkey-patching matplotlib and calling the real `shap.plots.bar`.

**Tech Stack:** TypeScript (strict), vitest, zero runtime dependencies.

## Global Constraints

- Read `../../../docs/shap-explain-spec.md` before starting. It is the normative spec; this plan implements §1, §3.2, §3.3, §3.4, §3.5 (V1, V2, V3) and §4 of it.
- Read `../../../CONTEXT.md` for vocabulary. One row is a **Sample**, never a subject/patient/instance/record. One column is a **Feature**.
- `src/core/**` MUST NOT import React, and MUST NOT import anything outside `packages/shap-svg/`.
- Every float comparison in tests uses a tolerance. Coordinates: `1e-6` absolute. Additivity: `1e-3` relative. Never assert exact float equality.
- Colours are exact string matches: positive `#ff0051`, negative `#008bfb`, missing `#848484`.
- `contract_version` currently `1`. An unrecognised version throws `UnsupportedContractVersionError`.
- TypeScript `strict: true`. No `any` in exported signatures.
- Commit after every task with a `feat:` or `test:` prefix.

---

### Task 1: Package scaffold and types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/core/types.ts`, `index.ts`, `react.ts`

**Interfaces:**
- Consumes: nothing
- Produces: the `Explanation` and `ParsedExplanation` types used by every later task

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "shap-svg",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "react": "^18.3.1",
    "@types/react": "^18.3.0"
  },
  "peerDependencies": { "react": ">=18" },
  "peerDependenciesMeta": { "react": { "optional": true } }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "index.ts", "react.ts", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/**/*.test.ts"] } });
```

- [ ] **Step 4: Create `src/core/types.ts`**

```ts
/** The wire payload. Core fields are named exactly as shap.Explanation names them. */
export type Explanation = {
  contract_version: number;
  values: number[][] | number[][][];
  base_values: number | number[] | number[][];
  data: number[][];
  feature_names: string[];
  sample_ids?: string[];
  output_names?: string[];
  model_name?: string;
  model_version?: string;
};

/** A validated Explanation with the class axis resolved away. */
export type ParsedExplanation = {
  /** n x p, class already selected */
  values: number[][];
  /** n x p */
  data: number[][];
  /** length n — always per Sample, even when the wire form was a scalar */
  baseValues: number[];
  /** length p */
  featureNames: string[];
  /** length n, undefined when the payload omitted it */
  sampleIds?: string[];
  outputName?: string;
  nSamples: number;
  nFeatures: number;
};

/** One row of a chart: either a real Feature or the collapsed Other features row. */
export type DisplayRow = {
  label: string;
  /** index into ParsedExplanation.featureNames, or null for the Other features row */
  featureIndex: number | null;
  /** the value this row draws — for the bar chart, mean(|phi|) */
  value: number;
  isOtherRow: boolean;
};

export type DisplayRows = {
  rows: DisplayRow[];
  /** how many Features were folded into the Other features row; 0 when none */
  collapsedCount: number;
};

export class UnsupportedContractVersionError extends Error {
  constructor(public readonly received: unknown) {
    super(`shap-svg supports contract_version 1, received ${JSON.stringify(received)}`);
    this.name = "UnsupportedContractVersionError";
  }
}

export class InvalidExplanationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExplanationError";
  }
}
```

- [ ] **Step 5: Create `index.ts` and `react.ts` barrels**

```ts
// index.ts
export * from "./src/core/types";
```

```ts
// react.ts
export {};
```

- [ ] **Step 6: Install and typecheck**

Run: `npm install && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shap-svg
git commit -m "feat(shap-svg): scaffold package and payload types"
```

---

### Task 2: `parseExplanation` — validation and class selection

**Files:**
- Create: `src/core/parse.ts`, `tests/parse.test.ts`
- Modify: `index.ts`

**Interfaces:**
- Consumes: `Explanation`, `ParsedExplanation`, the two error classes from Task 1
- Produces: `parseExplanation(input: unknown, opts?: { classIndex?: number }): ParsedExplanation`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/parse.test.ts
import { describe, expect, it } from "vitest";
import { parseExplanation } from "../src/core/parse";
import { UnsupportedContractVersionError, InvalidExplanationError } from "../src/core/types";

const base2d = {
  contract_version: 1,
  values: [[0.1, -0.2], [0.3, 0.4]],
  base_values: 0.5,
  data: [[1, 2], [3, 4]],
  feature_names: ["a", "b"],
};

describe("parseExplanation", () => {
  it("expands a scalar base_value to one per Sample", () => {
    const e = parseExplanation(base2d);
    expect(e.baseValues).toEqual([0.5, 0.5]);
    expect(e.nSamples).toBe(2);
    expect(e.nFeatures).toBe(2);
  });

  it("selects classIndex 1 from a 3-D values array by default", () => {
    const e = parseExplanation({
      ...base2d,
      values: [[[0.9, 0.1], [0.8, -0.2]], [[0.7, 0.3], [0.6, 0.4]]],
      base_values: [[0.4, 0.6], [0.4, 0.6]],
    });
    expect(e.values).toEqual([[0.1, -0.2], [0.3, 0.4]]);
    expect(e.baseValues).toEqual([0.6, 0.6]);
  });

  it("honours an explicit classIndex", () => {
    const e = parseExplanation({
      ...base2d,
      values: [[[0.9, 0.1], [0.8, -0.2]], [[0.7, 0.3], [0.6, 0.4]]],
      base_values: [[0.4, 0.6], [0.4, 0.6]],
    }, { classIndex: 0 });
    expect(e.values).toEqual([[0.9, 0.8], [0.7, 0.6]]);
    expect(e.baseValues).toEqual([0.4, 0.4]);
  });

  it("rejects an unknown contract_version", () => {
    expect(() => parseExplanation({ ...base2d, contract_version: 2 }))
      .toThrow(UnsupportedContractVersionError);
  });

  it("rejects a row whose length does not match feature_names", () => {
    expect(() => parseExplanation({ ...base2d, values: [[0.1], [0.3, 0.4]] }))
      .toThrow(InvalidExplanationError);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => parseExplanation({ ...base2d, values: [[NaN, 0], [0, 0]] }))
      .toThrow(InvalidExplanationError);
    expect(() => parseExplanation({ ...base2d, data: [[Infinity, 0], [0, 0]] }))
      .toThrow(InvalidExplanationError);
  });

  it("carries optional fields through", () => {
    const e = parseExplanation({ ...base2d, sample_ids: ["s1", "s2"], output_names: ["CRC"] });
    expect(e.sampleIds).toEqual(["s1", "s2"]);
    expect(e.outputName).toBe("CRC");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/parse.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/parse"`.

- [ ] **Step 3: Implement `src/core/parse.ts`**

```ts
import {
  Explanation, ParsedExplanation,
  InvalidExplanationError, UnsupportedContractVersionError,
} from "./types";

const SUPPORTED_CONTRACT_VERSION = 1;

function assertFinite(rows: number[][], field: string): void {
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      if (!Number.isFinite(rows[i][j])) {
        throw new InvalidExplanationError(
          `${field}[${i}][${j}] is ${rows[i][j]}; the payload must contain only finite numbers`,
        );
      }
    }
  }
}

function is3d(v: number[][] | number[][][]): v is number[][][] {
  return Array.isArray(v[0]) && Array.isArray((v[0] as unknown[])[0]);
}

export function parseExplanation(
  input: unknown,
  opts: { classIndex?: number } = {},
): ParsedExplanation {
  const e = input as Explanation;
  const classIndex = opts.classIndex ?? 1;

  if (e?.contract_version !== SUPPORTED_CONTRACT_VERSION) {
    throw new UnsupportedContractVersionError(e?.contract_version);
  }
  if (!Array.isArray(e.values) || !Array.isArray(e.data) || !Array.isArray(e.feature_names)) {
    throw new InvalidExplanationError("values, data and feature_names are required arrays");
  }

  const values: number[][] = is3d(e.values)
    ? e.values.map((row) => row.map((cell) => cell[classIndex]))
    : (e.values as number[][]);

  const nSamples = values.length;
  const nFeatures = e.feature_names.length;

  if (e.data.length !== nSamples) {
    throw new InvalidExplanationError(
      `data has ${e.data.length} Samples but values has ${nSamples}`,
    );
  }
  for (const [name, rows] of [["values", values], ["data", e.data]] as const) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length !== nFeatures) {
        throw new InvalidExplanationError(
          `${name}[${i}] has ${rows[i].length} Features but feature_names has ${nFeatures}`,
        );
      }
    }
  }

  let baseValues: number[];
  const bv = e.base_values;
  if (typeof bv === "number") {
    baseValues = new Array(nSamples).fill(bv);
  } else if (Array.isArray(bv) && Array.isArray(bv[0])) {
    baseValues = (bv as number[][]).map((row) => row[classIndex]);
  } else {
    baseValues = bv as number[];
  }
  if (baseValues.length !== nSamples) {
    throw new InvalidExplanationError(
      `base_values has ${baseValues.length} entries but there are ${nSamples} Samples`,
    );
  }

  assertFinite(values, "values");
  assertFinite(e.data, "data");
  assertFinite([baseValues], "base_values");

  return {
    values,
    data: e.data,
    baseValues,
    featureNames: e.feature_names,
    sampleIds: e.sample_ids,
    outputName: e.output_names?.[0],
    nSamples,
    nFeatures,
  };
}
```

- [ ] **Step 4: Export it and run the tests**

Add `export * from "./src/core/parse";` to `index.ts`.

Run: `npm test -- tests/parse.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shap-svg
git commit -m "feat(shap-svg): parse and validate Explanation payloads"
```

---

### Task 3: Global importance and Feature ordering

**Files:**
- Create: `src/core/order.ts`, `tests/order.test.ts`
- Modify: `index.ts`

**Interfaces:**
- Consumes: `ParsedExplanation` from Task 1
- Produces: `globalImportance(e: ParsedExplanation): number[]` and `orderFeatures(importance: number[]): number[]`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/order.test.ts
import { describe, expect, it } from "vitest";
import { globalImportance, orderFeatures } from "../src/core/order";
import { parseExplanation } from "../src/core/parse";

const e = parseExplanation({
  contract_version: 1,
  values: [[1, -4, 0.5], [3, -2, 0.5]],
  base_values: 0,
  data: [[0, 0, 0], [0, 0, 0]],
  feature_names: ["a", "b", "c"],
});

describe("globalImportance", () => {
  it("is mean of absolute SHAP value per Feature", () => {
    expect(globalImportance(e)).toEqual([2, 3, 0.5]);
  });
});

describe("orderFeatures", () => {
  it("orders descending by importance", () => {
    expect(orderFeatures([2, 3, 0.5])).toEqual([1, 0, 2]);
  });

  it("breaks ties by ascending index so ordering is stable", () => {
    expect(orderFeatures([1, 1, 1])).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/order.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/order.ts`**

```ts
import { ParsedExplanation } from "./types";

/** mean(|phi|) over Samples, per Feature — what shap.plots.bar collapses a 2-D Explanation to. */
export function globalImportance(e: ParsedExplanation): number[] {
  const out = new Array<number>(e.nFeatures).fill(0);
  for (const row of e.values) {
    for (let j = 0; j < e.nFeatures; j++) out[j] += Math.abs(row[j]);
  }
  return out.map((sum) => sum / e.nSamples);
}

/** Descending by importance; ties resolved by ascending index so renders are reproducible. */
export function orderFeatures(importance: number[]): number[] {
  return importance
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (b.value - a.value) || (a.index - b.index))
    .map((entry) => entry.index);
}
```

- [ ] **Step 4: Export and run the tests**

Add `export * from "./src/core/order";` to `index.ts`.

Run: `npm test -- tests/order.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shap-svg
git commit -m "feat(shap-svg): global importance and Feature ordering"
```

---

### Task 4: Value formatting (deviation V1)

**Files:**
- Create: `src/core/format.ts`, `tests/format.test.ts`
- Modify: `index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `formatShapValue(v: number): string` and `formatFeatureLabel(name: string): string`

SHAP's own `format_value(v, "%0.03f")` renders `0.0003` as `0` and `-0.0002` as `−0`, which is
useless for relative abundances. Spec §3.5 V1 replaces it. V3 covers the label.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/format.test.ts
import { describe, expect, it } from "vitest";
import { formatShapValue, formatFeatureLabel } from "../src/core/format";

describe("formatShapValue", () => {
  it("keeps three significant figures for ordinary magnitudes", () => {
    expect(formatShapValue(0.0125)).toBe("+0.0125");
    expect(formatShapValue(-0.5)).toBe("−0.5");
  });

  it("uses exponent notation rather than collapsing small values to zero", () => {
    expect(formatShapValue(0.0003)).toBe("+3e-4");
    expect(formatShapValue(-0.0002)).toBe("−2e-4");
  });

  it("renders an exact zero without a sign", () => {
    expect(formatShapValue(0)).toBe("0");
  });

  it("uses U+2212 MINUS SIGN, never ASCII hyphen, for the leading sign", () => {
    expect(formatShapValue(-1.5).startsWith("−")).toBe(true);
  });
});

describe("formatFeatureLabel", () => {
  it("replaces underscores with spaces", () => {
    expect(formatFeatureLabel("Fusobacterium_nucleatum")).toBe("Fusobacterium nucleatum");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/format.ts`**

```ts
const MINUS = "−";
/** Below this magnitude, fixed notation would round away to zero at our precision. */
const EXPONENT_THRESHOLD = 1e-3;

/**
 * Spec 3.5 V1. SHAP's "%0.03f" renders most relative-abundance-scale values as "0" or "-0";
 * this keeps them readable and always signs the value so a bar's direction is unambiguous.
 */
export function formatShapValue(v: number): string {
  if (v === 0) return "0";
  const magnitude = Math.abs(v);
  const body = magnitude < EXPONENT_THRESHOLD
    ? magnitude.toExponential(0).replace("e-", "e-")
    : String(Number(magnitude.toPrecision(3)));
  return (v < 0 ? MINUS : "+") + body;
}

/** Spec 3.5 V3. The italic styling is applied by the renderer, not here. */
export function formatFeatureLabel(name: string): string {
  return name.replace(/_/g, " ");
}
```

- [ ] **Step 4: Export and run the tests**

Add `export * from "./src/core/format";` to `index.ts`.

Run: `npm test -- tests/format.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shap-svg
git commit -m "feat(shap-svg): value and label formatting for microbiome scales"
```

---

### Task 5: `collapseToDisplay` — the Other features row, both modes

**Files:**
- Create: `src/core/collapse.ts`, `tests/collapse.test.ts`
- Modify: `index.ts`

**Interfaces:**
- Consumes: `ParsedExplanation`, `DisplayRow`, `DisplayRows` from Task 1; `formatFeatureLabel` from Task 4
- Produces: `collapseToDisplay(featureNames: string[], importance: number[], order: number[], maxDisplay: number, faithfulOtherRow: boolean): DisplayRows`

Spec §3.4. In faithful mode the last displayed row absorbs the Feature ranked `maxDisplay`, so
`maxDisplay = 3` over 5 Features yields 2 real rows plus one row summing ranks 2..4, labelled
`Sum of 3 other features`. In corrected mode (the default) 3 real rows are shown plus a row summing
ranks 3..4, labelled `2 other features`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/collapse.test.ts
import { describe, expect, it } from "vitest";
import { collapseToDisplay } from "../src/core/collapse";

const names = ["a", "b", "c", "d", "e"];
const importance = [5, 4, 3, 2, 1];
const order = [0, 1, 2, 3, 4];

describe("collapseToDisplay — corrected mode (default)", () => {
  it("shows maxDisplay real Features plus a separate Other features row", () => {
    const { rows, collapsedCount } = collapseToDisplay(names, importance, order, 3, false);
    expect(rows.map((r) => r.label)).toEqual(["a", "b", "c", "2 other features"]);
    expect(rows.map((r) => r.value)).toEqual([5, 4, 3, 3]);
    expect(rows[3].featureIndex).toBeNull();
    expect(rows[3].isOtherRow).toBe(true);
    expect(collapsedCount).toBe(2);
  });
});

describe("collapseToDisplay — faithful mode", () => {
  it("absorbs the Feature ranked maxDisplay, matching SHAP", () => {
    const { rows, collapsedCount } = collapseToDisplay(names, importance, order, 3, true);
    expect(rows.map((r) => r.label)).toEqual(["a", "b", "Sum of 3 other features"]);
    expect(rows.map((r) => r.value)).toEqual([5, 4, 6]);
    expect(collapsedCount).toBe(3);
  });
});

describe("collapseToDisplay — no collapsing needed", () => {
  it("returns every Feature and no Other features row", () => {
    const { rows, collapsedCount } = collapseToDisplay(names, importance, order, 10, false);
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.isOtherRow)).toBe(false);
    expect(collapsedCount).toBe(0);
  });
});

describe("collapseToDisplay — invariant", () => {
  it("total across displayed rows equals total across all Features, in both modes", () => {
    const total = importance.reduce((a, b) => a + b, 0);
    for (const faithful of [true, false]) {
      const { rows } = collapseToDisplay(names, importance, order, 3, faithful);
      const shown = rows.reduce((a, r) => a + r.value, 0);
      expect(Math.abs(shown - total) / total).toBeLessThan(1e-3);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/collapse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/collapse.ts`**

```ts
import { DisplayRow, DisplayRows } from "./types";
import { formatFeatureLabel } from "./format";

/**
 * Spec 3.4. `faithfulOtherRow` reproduces shap/plots/_bar.py:228-241, where the last displayed row
 * absorbs the Feature ranked `maxDisplay` — so maxDisplay=15 shows 14 real Features. The default
 * corrected mode shows `maxDisplay` real Features and adds the Other features row alongside.
 */
export function collapseToDisplay(
  featureNames: string[],
  importance: number[],
  order: number[],
  maxDisplay: number,
  faithfulOtherRow: boolean,
): DisplayRows {
  const p = order.length;

  if (maxDisplay >= p) {
    return {
      rows: order.map((index) => ({
        label: formatFeatureLabel(featureNames[index]),
        featureIndex: index,
        value: importance[index],
        isOtherRow: false,
      })),
      collapsedCount: 0,
    };
  }

  const realCount = faithfulOtherRow ? maxDisplay - 1 : maxDisplay;
  const rows: DisplayRow[] = order.slice(0, realCount).map((index) => ({
    label: formatFeatureLabel(featureNames[index]),
    featureIndex: index,
    value: importance[index],
    isOtherRow: false,
  }));

  const collapsed = order.slice(realCount);
  const collapsedValue = collapsed.reduce((sum, index) => sum + importance[index], 0);
  rows.push({
    label: faithfulOtherRow
      ? `Sum of ${collapsed.length} other features`
      : `${collapsed.length} other features`,
    featureIndex: null,
    value: collapsedValue,
    isOtherRow: true,
  });

  return { rows, collapsedCount: collapsed.length };
}
```

- [ ] **Step 4: Export and run the tests**

Add `export * from "./src/core/collapse";` to `index.ts`.

Run: `npm test -- tests/collapse.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shap-svg
git commit -m "feat(shap-svg): Other features row in faithful and corrected modes"
```

---

### Task 6: `barLayout` — pure geometry

**Files:**
- Create: `src/core/barLayout.ts`, `tests/barLayout.test.ts`
- Modify: `index.ts`

**Interfaces:**
- Consumes: `DisplayRows` from Task 5
- Produces: `barLayout(rows: DisplayRows, opts: BarLayoutOptions): BarLayout`, and the exported types `BarLayoutOptions`, `BarLayout`, `BarGeometry`

Spec §3.3. `row_height = 0.5` and `total_width = 0.7` are SHAP's values in data units; here they
become `rowHeight` in pixels and a bar thickness of `0.7 * rowHeight`. The x scale is linear from
`min(0, minValue)` to `max(0, maxValue)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/barLayout.test.ts
import { describe, expect, it } from "vitest";
import { barLayout } from "../src/core/barLayout";
import { DisplayRows } from "../src/core/types";

const rows: DisplayRows = {
  rows: [
    { label: "a", featureIndex: 0, value: 4, isOtherRow: false },
    { label: "b", featureIndex: 1, value: -2, isOtherRow: false },
    { label: "2 other features", featureIndex: null, value: 1, isOtherRow: true },
  ],
  collapsedCount: 2,
};

const opts = { width: 400, rowHeight: 50, marginLeft: 100, marginRight: 40, marginTop: 10 };

describe("barLayout", () => {
  it("puts zero inside the domain and scales to the plot width", () => {
    const l = barLayout(rows, opts);
    expect(l.xDomain).toEqual([-2, 4]);
    expect(l.plotWidth).toBe(260);
    expect(l.xZero).toBeCloseTo(100 + (2 / 6) * 260, 6);
  });

  it("gives each row a bar 0.7 of the row height, vertically centred", () => {
    const l = barLayout(rows, opts);
    expect(l.bars[0].height).toBeCloseTo(35, 6);
    expect(l.bars[0].y).toBeCloseTo(10 + 0.15 * 50, 6);
    expect(l.bars[1].y).toBeCloseTo(10 + 50 + 0.15 * 50, 6);
  });

  it("draws positive bars to the right of zero and negative bars to the left", () => {
    const l = barLayout(rows, opts);
    expect(l.bars[0].x).toBeCloseTo(l.xZero, 6);
    expect(l.bars[1].x + l.bars[1].width).toBeCloseTo(l.xZero, 6);
  });

  it("colours by sign, with zero counting as negative", () => {
    const l = barLayout(rows, opts);
    expect(l.bars[0].color).toBe("#ff0051");
    expect(l.bars[1].color).toBe("#008bfb");
    const zero = barLayout(
      { rows: [{ label: "z", featureIndex: 0, value: 0, isOtherRow: false }], collapsedCount: 0 },
      opts,
    );
    expect(zero.bars[0].color).toBe("#008bfb");
  });

  it("reports whether a zero rule is needed", () => {
    expect(barLayout(rows, opts).showZeroRule).toBe(true);
    const positiveOnly = barLayout(
      { rows: [{ label: "a", featureIndex: 0, value: 3, isOtherRow: false }], collapsedCount: 0 },
      opts,
    );
    expect(positiveOnly.showZeroRule).toBe(false);
  });

  it("sizes the svg to fit every row", () => {
    expect(barLayout(rows, opts).height).toBe(10 + 3 * 50 + 30);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/barLayout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/barLayout.ts`**

```ts
import { DisplayRows } from "./types";

export const POSITIVE_COLOR = "#ff0051";
export const NEGATIVE_COLOR = "#008bfb";

/** shap/plots/_bar.py:259 — total_width 0.7 of the row pitch. */
const BAR_THICKNESS_RATIO = 0.7;
/** Room below the last row for the x axis. */
const AXIS_HEIGHT = 30;

export type BarLayoutOptions = {
  width: number;
  rowHeight: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
};

export type BarGeometry = {
  label: string;
  featureIndex: number | null;
  isOtherRow: boolean;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** vertical centre of the row, for label baselines */
  centerY: number;
};

export type BarLayout = {
  bars: BarGeometry[];
  xDomain: [number, number];
  xZero: number;
  plotWidth: number;
  height: number;
  showZeroRule: boolean;
};

export function barLayout(rows: DisplayRows, opts: BarLayoutOptions): BarLayout {
  const { width, rowHeight, marginLeft, marginRight, marginTop } = opts;
  const plotWidth = width - marginLeft - marginRight;

  const values = rows.rows.map((r) => r.value);
  // Zero must always be in the domain, otherwise a bar would not start at the axis.
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const toX = (v: number) => marginLeft + ((v - min) / span) * plotWidth;
  const xZero = toX(0);

  const barHeight = rowHeight * BAR_THICKNESS_RATIO;
  const inset = (rowHeight - barHeight) / 2;

  const bars: BarGeometry[] = rows.rows.map((row, i) => {
    const rowTop = marginTop + i * rowHeight;
    const end = toX(row.value);
    // shap/plots/_bar.py:267-271 colours a value of exactly zero as negative.
    const positive = row.value > 0;
    return {
      label: row.label,
      featureIndex: row.featureIndex,
      isOtherRow: row.isOtherRow,
      value: row.value,
      x: positive ? xZero : end,
      y: rowTop + inset,
      width: Math.abs(end - xZero),
      height: barHeight,
      color: positive ? POSITIVE_COLOR : NEGATIVE_COLOR,
      centerY: rowTop + rowHeight / 2,
    };
  });

  return {
    bars,
    xDomain: [min, max],
    xZero,
    plotWidth,
    height: marginTop + rows.rows.length * rowHeight + AXIS_HEIGHT,
    // shap/plots/_bar.py:252-254 — the rule only appears when something is negative.
    showZeroRule: values.some((v) => v < 0),
  };
}
```

- [ ] **Step 4: Export and run the tests**

Add `export * from "./src/core/barLayout";` to `index.ts`.

Run: `npm test -- tests/barLayout.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shap-svg
git commit -m "feat(shap-svg): bar chart layout geometry"
```

---

### Task 7: Golden-value test against captured SHAP output

**Files:**
- Create: `tests/golden.bar.test.ts`
- Read: `fixtures/tiny.json`, `fixtures/tiny.bar.golden.json`, `fixtures/real.json`, `fixtures/real.bar.golden.json`, `fixtures/edge.json`

**Interfaces:**
- Consumes: everything from Tasks 2–6
- Produces: no new exports — this is the acceptance gate

The fixtures and golden files are already present in `fixtures/`. Do not regenerate them. Each
`*.bar.golden.json` was produced by monkey-patching `plt.barh` and calling the real
`shap.plots.bar(..., max_display=M)` on the matching fixture, and has this shape:

```jsonc
{
  "max_display": 10,
  "labels": ["Fusobacterium nucleatum", "...", "Sum of 192 other features"],
  "values": [0.0412, 0.0388, ...],   // bar lengths, in SHAP's own order
  "colors": ["#ff0051", ...]
}
```

Because SHAP's own bar absorbs the Feature ranked `max_display`, the golden files correspond to
`faithfulOtherRow: true`. That is the mode under test here; the corrected mode is covered by Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// tests/golden.bar.test.ts
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

  it("produces the same bar lengths as SHAP", () => {
    rows.forEach((row, i) => {
      expect(row.value).toBeCloseTo(golden.values[i], 6);
    });
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- tests/golden.bar.test.ts`
Expected: PASS. If a label differs, the ordering or the Other-features arithmetic is wrong — fix the
implementation, never the golden file.

- [ ] **Step 3: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shap-svg
git commit -m "test(shap-svg): bar chart matches values captured from SHAP"
```

---

### Task 8: `<ShapBar>` React component

**Files:**
- Create: `src/react/ShapBar.tsx`, `tests/ShapBar.test.ts`
- Modify: `react.ts`

**Interfaces:**
- Consumes: `parseExplanation`, `globalImportance`, `orderFeatures`, `collapseToDisplay`, `barLayout`, `formatShapValue`
- Produces: `ShapBar`, and the exported prop type `ShapBarProps`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ShapBar.test.ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { ShapBar } from "../src/react/ShapBar";

describe("ShapBar", () => {
  it("is a component that accepts an explanation and renders without throwing", () => {
    const element = createElement(ShapBar, {
      explanation: {
        contract_version: 1,
        values: [[1, -2]],
        base_values: 0,
        data: [[0, 0]],
        feature_names: ["Fusobacterium_nucleatum", "Bacteroides_fragilis"],
      },
      maxDisplay: 2,
    });
    expect(element.type).toBe(ShapBar);
    expect(typeof ShapBar).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/ShapBar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/react/ShapBar.tsx`**

```tsx
import { useId, useMemo, useState } from "react";
import { Explanation } from "../core/types";
import { parseExplanation } from "../core/parse";
import { globalImportance, orderFeatures } from "../core/order";
import { collapseToDisplay } from "../core/collapse";
import { barLayout } from "../core/barLayout";
import { formatShapValue } from "../core/format";

export type ShapBarProps = {
  explanation: Explanation;
  maxDisplay?: number;
  faithfulOtherRow?: boolean;
  classIndex?: number;
  width?: number;
  rowHeight?: number;
  onFeatureClick?: (featureIndex: number | null) => void;
};

export function ShapBar({
  explanation,
  maxDisplay = 10,
  faithfulOtherRow = false,
  classIndex = 1,
  width = 720,
  rowHeight = 26,
  onFeatureClick,
}: ShapBarProps) {
  // Namespacing element ids the way shap/plots/_text.py:88 does, so several charts
  // can share a page without colliding.
  const uid = useId().replace(/:/g, "");
  const [hovered, setHovered] = useState<number | null>(null);

  const layout = useMemo(() => {
    const parsed = parseExplanation(explanation, { classIndex });
    const importance = globalImportance(parsed);
    const order = orderFeatures(importance);
    const rows = collapseToDisplay(
      parsed.featureNames, importance, order, maxDisplay, faithfulOtherRow,
    );
    return barLayout(rows, {
      width, rowHeight, marginLeft: 260, marginRight: 90, marginTop: 8,
    });
  }, [explanation, maxDisplay, faithfulOtherRow, classIndex, width, rowHeight]);

  return (
    <svg width={width} height={layout.height} role="img"
         aria-label="Mean absolute SHAP value per feature">
      {layout.showZeroRule && (
        <line x1={layout.xZero} x2={layout.xZero} y1={0} y2={layout.height - 30}
              stroke="#000000" strokeWidth={1} />
      )}
      {layout.bars.map((bar, i) => (
        <g key={`${uid}-row-${i}`}
           onMouseEnter={() => setHovered(i)}
           onMouseLeave={() => setHovered(null)}
           onClick={() => onFeatureClick?.(bar.featureIndex)}
           style={{ cursor: onFeatureClick ? "pointer" : "default" }}>
          <rect x={0} y={bar.y - (rowHeight - bar.height) / 2}
                width={width} height={rowHeight}
                fill={hovered === i ? "#00000008" : "transparent"} />
          <text x={250} y={bar.centerY} textAnchor="end" dominantBaseline="middle"
                fontSize={13} fill="#333333"
                fontStyle={bar.isOtherRow ? "normal" : "italic"}>
            {bar.label}
          </text>
          <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height}
                fill={bar.color} stroke="rgba(255,255,255,0.8)" strokeWidth={1} />
          <text x={bar.x + bar.width + 6} y={bar.centerY} dominantBaseline="middle"
                fontSize={12} fill={bar.color}>
            {formatShapValue(bar.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: Export and run the tests**

Set `react.ts` to `export * from "./src/react/ShapBar";`.

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shap-svg
git commit -m "feat(shap-svg): ShapBar React component"
```

---

## Definition of done

- `npm test` passes, including both golden-value suites.
- `npm run typecheck` is clean.
- No file under `src/core/` imports React or anything outside `packages/shap-svg/`.
- `formatShapValue(0.0003)` does not return `"0"`.
