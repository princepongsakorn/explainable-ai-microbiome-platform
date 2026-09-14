import { PredictionStatus } from '../interface/prediction-class.enum';

/** One row of `GROUP BY prediction, status, class` over prediction records. */
export interface RecordCountRow {
  predictionId: string;
  status: PredictionStatus;
  class: number | null;
  /** Postgres returns COUNT(*) as a string. */
  count: string | number;
}

/** Samples per status. ALL is a filter value, never a sample's status. */
export type StatusCounts = Record<
  Exclude<PredictionStatus, PredictionStatus.ALL>,
  number
>;

export interface RecordCounts {
  total: number;
  success: number;
  error: number;
  byStatus: StatusCounts;
  /**
   * Samples per predicted class value, keyed by the value as a string. A value
   * has no fixed meaning here: models may be multi-class, and what 0 or 1
   * stands for belongs to the model. Unclassified samples are left out.
   */
  byClass: Record<string, number>;
}

export const emptyRecordCounts = (): RecordCounts => ({
  total: 0,
  success: 0,
  error: 0,
  byStatus: { PENDING: 0, IN_PROGRESS: 0, SUCCESS: 0, ERROR: 0, CANCELED: 0 },
  byClass: {},
});

export function foldRecordCounts(
  predictionIds: string[],
  rows: RecordCountRow[],
): Map<string, RecordCounts> {
  const counts = new Map(predictionIds.map((id) => [id, emptyRecordCounts()]));

  for (const row of rows) {
    const entry = counts.get(row.predictionId);
    if (!entry) continue;
    const count = Number(row.count);
    entry.total += count;
    if (row.status in entry.byStatus) {
      entry.byStatus[row.status as keyof StatusCounts] += count;
    }
    if (row.class !== null && row.class !== undefined) {
      const key = String(row.class);
      entry.byClass[key] = (entry.byClass[key] ?? 0) + count;
    }
  }

  for (const entry of counts.values()) {
    entry.success = entry.byStatus.SUCCESS;
    entry.error = entry.byStatus.ERROR;
  }
  return counts;
}
