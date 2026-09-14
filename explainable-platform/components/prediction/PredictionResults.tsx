import { classColor, classLabel } from "@/lib/classes";

/** How a prediction's classified samples split across classes. */
export function PredictionResults({ byClass }: { byClass?: Record<string, number> }) {
  const classes = Object.entries(byClass ?? {})
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => Number(b) - Number(a));
  const total = classes.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="flex min-w-[10rem] flex-col gap-1.5">
      <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {classes.map(([value, count]) => (
          <div
            key={value}
            className={classColor(value)}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {classes.map(([value, count]) => `${count} ${classLabel(value)}`).join(" · ")}
      </span>
    </div>
  );
}
