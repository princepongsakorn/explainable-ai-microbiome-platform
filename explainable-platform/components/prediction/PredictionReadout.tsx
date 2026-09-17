import { Badge } from "@/components/ui/badge";
import { POSITIVE_THRESHOLD, classificationLabel } from "@/lib/classes";
import { EMPTY_VALUE, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

// Like the sample statuses next door, the theme has no token for a predicted
// class, so the two colours live here in the one place that decides them. They
// echo the charts — what raises the prediction is red there and here, what
// lowers it is blue — so the badge and the bars below it agree.
const CLASS_STYLE = {
  positive: { className: "bg-rose-50 text-rose-800", dot: "bg-rose-600" },
  negative: { className: "bg-sky-50 text-sky-800", dot: "bg-sky-600" },
};

export function ClassBadge({ predictedClass }: { predictedClass: number | string }) {
  const style = String(predictedClass) === "1" ? CLASS_STYLE.positive : CLASS_STYLE.negative;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 whitespace-nowrap border-transparent font-medium", style.className)}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", style.dot)} />
      {classificationLabel(predictedClass)}
    </Badge>
  );
}

/**
 * A sample's predicted probability and the class it implies.
 *
 * Renders as inline text so it can sit inside a Sheet or Dialog description
 * without nesting a block element in a paragraph. The figure carries its weight
 * from the foreground token against the muted line around it rather than from a
 * size of its own — it is the subject of the panel, not a dashboard headline.
 */
export function PredictionReadout({
  probability,
  predictedClass,
  className,
}: {
  probability?: number | string | null;
  /**
   * The stored class, which is authoritative. Left out — as it is for a
   * breakdown opened from a point on a cohort chart, where only the model
   * output is to hand — the class is read off the probability instead.
   */
  predictedClass?: number | string | null;
  className?: string;
}) {
  const value = probability === null || probability === undefined ? null : Number(probability);
  const known = value !== null && Number.isFinite(value);
  const resolvedClass =
    predictedClass ?? (known ? (value >= POSITIVE_THRESHOLD ? 1 : 0) : null);

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <span>
        Probability{" "}
        <span className="font-medium tabular-nums text-foreground">
          {known ? formatPercent(value) : EMPTY_VALUE}
        </span>
      </span>
      {resolvedClass !== null && <ClassBadge predictedClass={resolvedClass} />}
    </span>
  );
}
