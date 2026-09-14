import { IRecordCounts, PredictionStatus } from "@/components/model/model.interface";
import { STATUS_STYLE } from "@/components/prediction/StatusBadge";

const BAR_ORDER = [
  PredictionStatus.SUCCESS,
  PredictionStatus.ERROR,
  PredictionStatus.CANCELED,
  PredictionStatus.IN_PROGRESS,
  PredictionStatus.PENDING,
] as const;

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * How far a prediction's samples have got, as a bar and in words. The count
 * is of samples that succeeded: an errored or canceled sample has no result,
 * so counting it as done read "20 / 20" for a prediction with 3 results.
 * Those are named beside it instead.
 */
export function PredictionProgress({ records }: { records: IRecordCounts }) {
  const { byStatus, total } = records;

  // A backend without per-status counts still says how many succeeded.
  if (!byStatus) {
    return (
      <span className="text-xs tabular-nums text-muted-foreground">
        {records.success} / {total} succeeded
      </span>
    );
  }

  const breakdown = BAR_ORDER.filter((status) => byStatus[status] > 0)
    .map((status) => `${byStatus[status]} ${STATUS_STYLE[status].label.toLowerCase()}`)
    .join(", ");

  return (
    <div className="flex min-w-[10rem] flex-col gap-1.5" title={breakdown || "No samples"}>
      <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {total > 0 &&
          BAR_ORDER.map(
            (status) =>
              byStatus[status] > 0 && (
                <div
                  key={status}
                  className={STATUS_STYLE[status].dot}
                  style={{ width: `${(byStatus[status] / total) * 100}%` }}
                />
              )
          )}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {byStatus.SUCCESS} / {total} succeeded
        {byStatus.ERROR > 0 && (
          <span className="text-destructive"> · {plural(byStatus.ERROR, "error", "errors")}</span>
        )}
        {byStatus.CANCELED > 0 && <span> · {byStatus.CANCELED} canceled</span>}
      </span>
    </div>
  );
}
