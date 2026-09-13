import { DisplayRows } from "./types";

/**
 * The order the displayed Feature rows are drawn in.
 *
 * `importance` is SHAP's own order and the default. The other two only
 * *reorder* the rows importance already chose — they never change which
 * Features are shown. Sorting every Feature by name and taking the first N
 * would show whatever happens to begin with A, not what the model relies on.
 */
export type RowSort = "importance" | "name" | "featureValue";

/**
 * Reorder a collapsed set of rows.
 *
 * * `name` — alphabetical, ignoring case.
 * * `featureValue` — mean feature value across Samples, highest first. For
 *   this platform that is mean relative abundance, so the most abundant taxa
 *   sit on top.
 *
 * Ties keep importance order, so a sort is stable and repeatable. The Other
 * row is not a Feature and always stays last.
 */
export function sortDisplayRows(
  display: DisplayRows,
  sort: RowSort,
  data: number[][],
): DisplayRows {
  if (sort === "importance") return display;

  const meanOf = (featureIndex: number) =>
    data.length === 0
      ? 0
      : data.reduce((sum, sample) => sum + sample[featureIndex], 0) / data.length;

  const keyed = display.rows
    .filter((row) => !row.isOtherRow)
    .map((row, rank) => ({
      row,
      rank,
      mean: row.featureIndex === null ? 0 : meanOf(row.featureIndex),
    }));

  keyed.sort((a, b) => {
    const primary = sort === "name"
      ? a.row.label.localeCompare(b.row.label, undefined, { sensitivity: "base" })
      : b.mean - a.mean;
    return primary || a.rank - b.rank;
  });

  return {
    ...display,
    rows: [...keyed.map((k) => k.row), ...display.rows.filter((row) => row.isOtherRow)],
  };
}
