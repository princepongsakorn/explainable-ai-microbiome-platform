import { PredictionStatus } from "@/components/model/model.interface";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// The theme has no success or info tokens, so the status colours live here,
// in the one place that decides them.
const STATUS_STYLE: Record<string, { label: string; className: string; dot: string }> = {
  [PredictionStatus.SUCCESS]: {
    label: "Success",
    className: "bg-green-50 text-green-800",
    dot: "bg-green-600",
  },
  [PredictionStatus.ERROR]: {
    label: "Error",
    className: "bg-red-50 text-red-800",
    dot: "bg-red-600",
  },
  [PredictionStatus.CANCELED]: {
    label: "Canceled",
    className: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  [PredictionStatus.IN_PROGRESS]: {
    label: "In Progress",
    className: "bg-blue-50 text-blue-800",
    dot: "bg-blue-600 animate-pulse motion-reduce:animate-none",
  },
  [PredictionStatus.PENDING]: {
    label: "Pending",
    className: "bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
};

export function StatusBadge({ status }: { status?: PredictionStatus }) {
  const style = STATUS_STYLE[status ?? PredictionStatus.PENDING] ?? STATUS_STYLE.PENDING;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 whitespace-nowrap border-transparent font-medium", style.className)}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", style.dot)} />
      {style.label}
    </Badge>
  );
}
