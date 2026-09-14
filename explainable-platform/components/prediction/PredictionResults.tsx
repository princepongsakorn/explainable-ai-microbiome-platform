import { classLabel } from "@/lib/classes";

/** How a prediction's classified samples split across classes, in words. */
export function PredictionResults({ byClass }: { byClass?: Record<string, number> }) {
  const classes = Object.entries(byClass ?? {})
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => Number(b) - Number(a));

  if (classes.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span className="whitespace-nowrap tabular-nums">
      {classes.map(([value, count]) => `${count} ${classLabel(value)}`).join(" · ")}
    </span>
  );
}
