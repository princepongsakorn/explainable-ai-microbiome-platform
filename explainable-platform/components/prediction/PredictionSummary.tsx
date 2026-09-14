import { IPredictionSummary } from "@/components/model/model.interface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The three figures above the prediction list. `undefined` while loading,
 * `null` when the request failed: the figures then read "—" and the table
 * below carries on.
 */
export function PredictionSummary({ summary }: { summary?: IPredictionSummary | null }) {
  const figures = [
    {
      label: "In Progress",
      value: summary?.inProgress,
      hint: "Predictions with samples still waiting or running.",
      alert: false,
    },
    {
      label: "Needs Attention",
      value: summary?.needsAttention,
      hint: "Predictions with at least one failed sample.",
      alert: true,
    },
    {
      label: "Uploaded in the Last 7 Days",
      value: summary?.uploadedLast7Days,
      hint: "Predictions created in the past week.",
      alert: false,
    },
  ];

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {figures.map((figure) => (
        <div key={figure.label} className="rounded-lg border bg-card p-4">
          <dt className="text-sm text-muted-foreground">{figure.label}</dt>
          <dd
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              figure.alert && (figure.value ?? 0) > 0 && "text-destructive"
            )}
          >
            {summary === undefined ? <Skeleton className="h-8 w-12" /> : figure.value ?? "—"}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">{figure.hint}</p>
        </div>
      ))}
    </dl>
  );
}
