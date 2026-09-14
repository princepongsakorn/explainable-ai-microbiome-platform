import { ReactNode, useEffect, useId, useState } from "react";
import { ArrowsPointingOutIcon } from "@heroicons/react/24/outline";
import { genusOf } from "shap-svg";
import type { Explanation, PlotLabels, RowSort, ValuePrecision } from "shap-svg";
import { Plots } from "shap-svg/react";
import { useExplanation, sampleIndexOf } from "@/lib/useExplanation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const MIN_DISPLAY = 5;
const MAX_DISPLAY = 50;
const DEFAULT_DISPLAY = 15;
const PRECISIONS: { value: ValuePrecision; label: string; hint: string }[] = [
  { value: 2, label: "2", hint: "Two decimal places" },
  { value: 3, label: "3", hint: "Three decimal places" },
  { value: 4, label: "4", hint: "Four decimal places" },
  {
    value: "percent",
    label: "%",
    hint: "As a percentage — reaches values too small to show as decimals",
  },
];
const DEFAULT_PRECISION: ValuePrecision = 2;
const ROW_SORTS: { value: RowSort; label: string }[] = [
  { value: "importance", label: "Importance" },
  { value: "name", label: "Name" },
  { value: "featureValue", label: "Feature value" },
];

/**
 * The charts' text in the terms a microbiome researcher reads results in. The
 * numbers are SHAP's, unchanged; only what they are called differs from SHAP's
 * figures. Every model this platform serves explains a predicted probability.
 */
const RESEARCH_LABELS: Partial<PlotLabels> = {
  shapValue: "Contribution",
  shapValueAxis: "Contribution to predicted probability",
  meanAbsShapValue: "Mean absolute contribution",
  featureValue: "Relative abundance",
  missingFeatureValue: "not measured",
  samples: "Samples",
  sampleTotal: "Total contribution",
  baseValue: "Average prediction",
  modelOutput: "Prediction",
  otherFeatures: (count) => `${count} other taxa`,
};

const INLINE_WIDTH = 720;
/** Room for the expanded view's own padding, so the chart does not sit under its edge. */
const EXPANDED_CHROME = 96;
/** Below this, expanding is no more readable than the inline view. */
const MIN_EXPANDED_WIDTH = 900;
/** Rows get taller when expanded — reading them is the point of expanding. */
const EXPANDED_ROW_SCALE = 1.35;

const nativeControl =
  "rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Everything a chart needs to draw itself at the size the frame decided on. */
type ChartView = {
  explanation: Explanation;
  maxDisplay: number;
  decimals: ValuePrecision;
  groupByGenus: boolean;
  rowSort: RowSort;
  width: number;
  rowHeight: number;
};

/** Viewport width, tracked only while something needs it. */
function useViewportWidth(active: boolean) {
  const [width, setWidth] = useState(1280);

  useEffect(() => {
    if (!active) return;
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [active]);

  return width;
}

/**
 * Shared shell: fetch state, the controls, and the expanded view.
 *
 * The controls change only what is drawn from a payload already in memory,
 * which is the point of shipping values instead of a rendered image — there is
 * no request behind any of them, expanding included.
 */
function ChartFrame({
  predictionId,
  title,
  children,
  emptyLabel,
  rowHeight,
  showPrecision = false,
  showRowSort = false,
}: {
  predictionId?: string;
  /** Names the chart in the expanded view. */
  title: string;
  emptyLabel: string;
  rowHeight: number;
  /** Offer the decimal-places control. Only the waterfall labels each bar. */
  showPrecision?: boolean;
  /** Offer the row-order control. Only beeswarm and heatmap have rows to reorder freely. */
  showRowSort?: boolean;
  children: (view: ChartView) => ReactNode;
}) {
  const { explanation, error, loading, progress } = useExplanation(predictionId);
  const [maxDisplay, setMaxDisplay] = useState(DEFAULT_DISPLAY);
  const [decimals, setDecimals] = useState<ValuePrecision>(DEFAULT_PRECISION);
  const [groupByGenus, setGroupByGenus] = useState(false);
  const [rowSort, setRowSort] = useState<RowSort>("importance");
  const [expanded, setExpanded] = useState(false);

  // Three frames can share a drawer, and the expanded view repeats the
  // controls, so the controls' ids cannot come from the prediction alone.
  const controlId = useId();
  const viewportWidth = useViewportWidth(expanded);

  // Only while there is nothing to show: a revalidation keeps the chart up.
  if (loading && !explanation) {
    return (
      <div role="status" className="py-4 text-sm text-muted-foreground">
        Loading explanation…
      </div>
    );
  }
  if (error || !explanation) {
    return (
      <div role="status" className="py-4 text-sm text-muted-foreground">
        {/* The job reports its progress over SSE, and takes about a minute for
            a few hundred Samples — long enough that "not computed yet" on its
            own reads as a failure rather than as a wait. */}
        {progress
          ? `Computing explanation… ${progress.done} / ${progress.total} samples`
          : error ?? emptyLabel}
      </div>
    );
  }

  // Grouped, the slider counts genera — the rows the chart actually has.
  const featureCount = groupByGenus
    ? new Set(explanation.feature_names.map(genusOf)).size
    : explanation.feature_names.length;
  const sliderMax = Math.min(MAX_DISPLAY, featureCount);
  const shown = Math.min(maxDisplay, sliderMax);

  const controls = (placement: "inline" | "expanded") => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <label htmlFor={`${controlId}-${placement}-shown`}>Features shown</label>
      <input
        id={`${controlId}-${placement}-shown`}
        type="range"
        // A chart with fewer rows than the usual minimum still gets a slider
        // whose range is valid.
        min={Math.min(MIN_DISPLAY, sliderMax)}
        max={sliderMax}
        value={shown}
        onChange={(event) => setMaxDisplay(Number(event.target.value))}
        className="min-w-[8rem] flex-1 accent-primary"
      />
      <span className="w-16 text-right tabular-nums text-foreground">
        {shown} / {featureCount}
      </span>
      <label className="flex items-center gap-1.5 whitespace-nowrap border-l pl-3">
        <input
          type="checkbox"
          checked={groupByGenus}
          onChange={(event) => setGroupByGenus(event.target.checked)}
          className="accent-primary"
        />
        Group by genus
      </label>
      {showRowSort && (
        <label className="flex items-center gap-1.5 whitespace-nowrap border-l pl-3">
          Sort
          <select
            value={rowSort}
            onChange={(event) => setRowSort(event.target.value as RowSort)}
            className={nativeControl}
          >
            {ROW_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {showPrecision && (
        <span className="flex items-center gap-1.5 border-l pl-3">
          <span id={`${controlId}-${placement}-precision`}>Values</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-labelledby={`${controlId}-${placement}-precision`}
            value={String(decimals)}
            onValueChange={(value) => {
              const option = PRECISIONS.find((item) => String(item.value) === value);
              if (option) setDecimals(option.value);
            }}
          >
            {PRECISIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={String(option.value)}
                title={option.hint}
                aria-label={option.hint}
                className="h-7 min-w-7 px-2 tabular-nums"
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </span>
      )}
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">{controls("inline")}</div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setExpanded(true)}
          aria-label={`Expand ${title} to full screen`}
        >
          <ArrowsPointingOutIcon aria-hidden="true" />
          Expand
        </Button>
      </div>

      <div className="overflow-x-auto">
        {children({
          explanation,
          maxDisplay: shown,
          decimals,
          groupByGenus,
          rowSort,
          width: INLINE_WIDTH,
          rowHeight,
        })}
      </div>

      {/* A Radix Dialog rather than an overlay portalled by hand: these charts
          sit inside a modal Sheet, which makes everything outside it inert,
          and only a nested Radix layer is let through. Radix also brings the
          focus trap, Escape and scroll lock the hand-built overlay had to. */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="flex h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 p-0"
          // Centred on the py-3 header's text-base title rather than a p-6 one.
          closeClassName="top-3"
        >
          <DialogHeader className="border-b px-4 py-3 pr-12 text-left">
            <DialogTitle className="text-base">{title}</DialogTitle>
            <DialogDescription className="sr-only">
              The {title} chart at full size, with the same controls.
            </DialogDescription>
          </DialogHeader>
          <div className="border-b px-4 py-3">{controls("expanded")}</div>
          <div className="flex-1 overflow-auto overscroll-contain p-4">
            {children({
              explanation,
              maxDisplay: shown,
              decimals,
              groupByGenus,
              rowSort,
              width: Math.max(MIN_EXPANDED_WIDTH, viewportWidth - EXPANDED_CHROME),
              rowHeight: Math.round(rowHeight * EXPANDED_ROW_SCALE),
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Mean absolute SHAP value per feature, across every sample in the prediction. */
export function GlobalImportanceChart({ predictionId }: { predictionId?: string }) {
  return (
    <ChartFrame
      predictionId={predictionId}
      title="Feature importance"
      emptyLabel="No explanation available."
      rowHeight={26}
    >
      {({ explanation, maxDisplay, groupByGenus, width, rowHeight }) => (
        <Plots.bar
          explanation={explanation}
          labels={RESEARCH_LABELS}
          groupByGenus={groupByGenus}
          maxDisplay={maxDisplay}
          width={width}
          rowHeight={rowHeight}
        />
      )}
    </ChartFrame>
  );
}

/** One dot per sample per feature, coloured by that sample's abundance. */
export function GlobalBeeswarmChart({ predictionId }: { predictionId?: string }) {
  return (
    <ChartFrame
      predictionId={predictionId}
      title="Beeswarm"
      showRowSort
      emptyLabel="No explanation available."
      rowHeight={28}
    >
      {({ explanation, maxDisplay, groupByGenus, rowSort, width, rowHeight }) => (
        <Plots.beeswarm
          explanation={explanation}
          labels={RESEARCH_LABELS}
          groupByGenus={groupByGenus}
          rowSort={rowSort}
          maxDisplay={maxDisplay}
          width={width}
          rowHeight={rowHeight}
        />
      )}
    </ChartFrame>
  );
}

/**
 * One cell per sample per feature, coloured by the SHAP value.
 *
 * Clicking a column hands back the sample id so the caller can open that
 * sample's breakdown — the data is already in memory, so it costs no request.
 * The original PNG labelled its x axis "Instances" and nothing more, which made
 * the substructure it exists to show impossible to read.
 */
export function GlobalHeatmapChart({
  predictionId,
  onSampleClick,
}: {
  predictionId?: string;
  onSampleClick?: (sampleId: string) => void;
}) {
  return (
    <ChartFrame
      predictionId={predictionId}
      title="Heatmap"
      showRowSort
      emptyLabel="No explanation available."
      rowHeight={26}
    >
      {({ explanation, maxDisplay, groupByGenus, rowSort, width, rowHeight }) => (
        <Plots.heatmap
          explanation={explanation}
          labels={RESEARCH_LABELS}
          groupByGenus={groupByGenus}
          rowSort={rowSort}
          maxDisplay={maxDisplay}
          width={width}
          rowHeight={rowHeight}
          onSampleClick={onSampleClick}
        />
      )}
    </ChartFrame>
  );
}

/**
 * One sample's contributions, from the model output back to the base value.
 *
 * Sliced out of the prediction's payload rather than fetched per record — the
 * SHAP values were computed once for the whole batch.
 */
export function LocalWaterfallChart({
  predictionId,
  recordId,
}: {
  predictionId?: string;
  recordId?: string;
}) {
  return (
    <ChartFrame
      predictionId={predictionId}
      title="Contribution breakdown"
      emptyLabel="No explanation available for this prediction."
      rowHeight={30}
      showPrecision
    >
      {({ explanation, maxDisplay, decimals, groupByGenus, width, rowHeight }) => {
        const sampleIndex = sampleIndexOf(explanation, recordId);
        if (sampleIndex < 0) {
          return (
            <div className="py-2 text-sm text-muted-foreground">
              This record is not in the prediction&apos;s explanation.
            </div>
          );
        }
        return (
          <Plots.waterfall
            explanation={explanation}
            labels={RESEARCH_LABELS}
            groupByGenus={groupByGenus}
            sampleIndex={sampleIndex}
            maxDisplay={maxDisplay}
            decimals={decimals}
            width={width}
            rowHeight={rowHeight}
          />
        );
      }}
    </ChartFrame>
  );
}
