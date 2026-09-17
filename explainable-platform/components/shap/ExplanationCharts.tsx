import { ReactNode, useEffect, useId, useState } from "react";
import { ArrowsPointingOutIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import {
  genusOf,
  globalImportance,
  groupExplanationByGenus,
  orderFeatures,
  parseExplanation,
} from "shap-svg";
import type { Explanation, PlotLabels, RowSort, ValuePrecision } from "shap-svg";
import { Plots } from "shap-svg/react";
import { useExplanation, sampleIndexOf } from "@/lib/useExplanation";
import { useElementWidth } from "@/lib/useElementWidth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChartSection } from "@/components/shap/ChartSection";
import { PredictionReadout } from "@/components/prediction/PredictionReadout";

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
  // A zero here is a taxon the sequencing did not find, which is a different
  // statement from "found at a low level" — the charts keep the two apart and
  // so does the wording.
  absent: "Not detected",
  absentWithCount: (count) => `Not detected (n = ${count})`,
  cumulativeShapValue: "Predicted probability",
  higher: "raises",
  lower: "lowers",
  weakInteraction: "no strong interaction with another taxon",
  tableCaption: "The values this chart draws",
  // A principal component means nothing by itself; the chart measures whether
  // it lines up with the summed contributions and only then says so.
  componentTracksTotal: (r) => `tracks total contribution (r = ${r.toFixed(2)})`,
  // The key is boxed and sits beside its own gradient, so it no longer reads as
  // an axis and no longer needs a word saying it is a colour scale.
  colorScale: (what) => what,
};

/**
 * How the two per-sample charts are introduced, defined once.
 *
 * They appear both on a sample's own page and in the dialog a point on a global
 * chart opens; a reader arriving either way should be reading the same words.
 */
export const LOCAL_CHART_COPY = {
  glance: {
    title: "Contributions at a Glance",
    description:
      "The same breakdown on a single line. What raises this sample’s prediction pushes in from the left and what lowers it from the right; they meet where the prediction landed.",
  },
  breakdown: {
    title: "Contribution Breakdown",
    description:
      "How this sample’s taxa move the prediction from the model’s average to its final output. Red pushes the prediction up and blue pushes it down; the bars add up to the difference.",
  },
} as const;

/** Inline width before the chart's box has been measured. */
const INLINE_WIDTH = 720;
/**
 * The narrowest an inline chart is drawn. shap-svg keeps a fixed 260px column
 * for taxon names, so below this the bars get too little room; the box
 * scrolls sideways instead.
 */
const MIN_INLINE_WIDTH = 560;
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
  extraControls,
  showMaxDisplay = true,
  showPrecision = false,
  showRowSort = false,
}: {
  predictionId?: string;
  /** Names the chart in the expanded view. */
  title: string;
  emptyLabel: string;
  rowHeight: number;
  /**
   * A chart's own switches, rendered in the shared control row so they sit
   * beside the ones every chart has rather than in a second row below.
   */
  extraControls?: ReactNode;
  /**
   * Offer the row-count slider. The scatter draws one Feature and the
   * embedding projects all of them, so for those two it controls nothing and
   * inviting a reader to drag it is a lie.
   */
  showMaxDisplay?: boolean;
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
  // Inline, the chart fills whatever holds it, a drawer or a page, rather
  // than a fixed width that left the rest of a wide drawer empty.
  const [chartBoxRef, chartBoxWidth] = useElementWidth<HTMLDivElement>();

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
      {showMaxDisplay && (
        <>
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
        </>
      )}
      <label className={`flex items-center gap-1.5 whitespace-nowrap ${showMaxDisplay ? "border-l pl-3" : ""}`}>
        <input
          type="checkbox"
          checked={groupByGenus}
          onChange={(event) => setGroupByGenus(event.target.checked)}
          className="accent-primary"
        />
        Group by genus
      </label>
      {extraControls}
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

      <div ref={chartBoxRef} className="overflow-x-auto">
        {children({
          explanation,
          maxDisplay: shown,
          decimals,
          groupByGenus,
          rowSort,
          width: Math.max(MIN_INLINE_WIDTH, chartBoxWidth ?? INLINE_WIDTH),
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
  /** Given, it replaces the built-in breakdown dialog. */
  onSampleClick?: (sampleId: string) => void;
}) {
  const [peek, setPeek] = useState<number | null>(null);

  return (
    <ChartFrame
      predictionId={predictionId}
      title="Heatmap"
      showRowSort
      emptyLabel="No explanation available."
      rowHeight={26}
    >
      {({ explanation, maxDisplay, groupByGenus, rowSort, width, rowHeight }) => (
        <>
        <Plots.heatmap
          explanation={explanation}
          labels={RESEARCH_LABELS}
          groupByGenus={groupByGenus}
          rowSort={rowSort}
          maxDisplay={maxDisplay}
          width={width}
          rowHeight={rowHeight}
          onSampleClick={(sampleId) =>
            onSampleClick
              ? onSampleClick(sampleId)
              : setPeek(sampleIndexOf(explanation, sampleId))
          }
        />
        <SampleDialog
          predictionId={predictionId}
          explanation={explanation}
          sampleIndex={peek}
          onOpenChange={(open) => !open && setPeek(null)}
        />
        </>
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

/**
 * One Sample's own breakdown, opened by clicking its point on a global chart.
 *
 * The global charts answer "which taxa, across everyone"; a point on them is a
 * person, and until now clicking one did nothing. This keeps the reader where
 * they were — the cohort view stays behind the dialog — rather than navigating
 * away and losing the position they clicked from.
 */
/**
 * A Sample's model output, read straight off the payload.
 *
 * `f(x)` is the Base value plus that Sample's contributions — an invariant of
 * the explanation contract, not an approximation — so a breakdown opened from a
 * cohort chart can show the probability without fetching the record.
 */
function modelOutputOf(explanation: Explanation, sampleIndex: number): number | null {
  try {
    const parsed = parseExplanation(explanation);
    const total = parsed.values[sampleIndex].reduce((sum, value) => sum + value, 0);
    return parsed.baseValues[sampleIndex] + total;
  } catch {
    return null;
  }
}

function SampleDialog({
  predictionId,
  explanation,
  sampleIndex,
  onOpenChange,
}: {
  predictionId?: string;
  explanation: Explanation;
  /** null while closed. */
  sampleIndex: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  const dialogId = useId();
  const open = sampleIndex !== null;
  const recordId = sampleIndex === null ? undefined : explanation.sample_ids?.[sampleIndex];
  const name =
    sampleIndex === null
      ? ""
      : explanation.sample_labels?.[sampleIndex] ?? `Sample ${sampleIndex + 1}`;
  const modelOutput =
    sampleIndex === null ? null : modelOutputOf(explanation, sampleIndex);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100vh-4rem)] max-w-6xl flex-col gap-0 p-0">
        <DialogHeader className="space-y-1 border-b px-6 py-4 pr-12 text-left">
          <DialogTitle className="text-base">{name}</DialogTitle>
          <DialogDescription>
            {/* The model output is the Base value plus every contribution, which
                is the definition the payload guarantees — so the probability is
                already here and needs no second request. */}
            <PredictionReadout probability={modelOutput} />
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto overscroll-contain p-4">
          {recordId ? (
            <div className="flex flex-col gap-8">
              {/* The same headings and wording the sample's own page uses, so a
                  reader who arrives here by clicking a point and a reader who
                  arrives from the table are reading the same thing. */}
              <ChartSection
                id={`${dialogId}-glance`}
                title={LOCAL_CHART_COPY.glance.title}
                description={LOCAL_CHART_COPY.glance.description}
              >
                <LocalForceChart predictionId={predictionId} recordId={recordId} />
              </ChartSection>
              <Separator />
              <ChartSection
                id={`${dialogId}-breakdown`}
                title={LOCAL_CHART_COPY.breakdown.title}
                description={LOCAL_CHART_COPY.breakdown.description}
              >
                <LocalWaterfallChart predictionId={predictionId} recordId={recordId} />
              </ChartSection>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This prediction&apos;s explanation does not carry sample identifiers, so the
              individual breakdown cannot be looked up.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One taxon's abundance against its contribution, one dot per sample.
 *
 * The question this answers and the others cannot: is more of this taxon always
 * worse, or is there a level below which it does not matter? Samples where the
 * taxon was not detected sit in their own band at the left, because a zero is a
 * real absence rather than a small number, and the rest are on a log axis.
 */
export function GlobalDependenceChart({ predictionId }: { predictionId?: string }) {
  const [feature, setFeature] = useState<string | null>(null);
  const [peek, setPeek] = useState<number | null>(null);
  // Off by default. SHAP colours these dots by a second taxon — whichever one
  // interacts most with the plotted one — which answers a real question but
  // introduces a variable the reader did not ask for, and reads as a mystery
  // until someone explains it.
  const [colorByInteraction, setColorByInteraction] = useState(false);
  const selectId = useId();

  return (
    <ChartFrame
      predictionId={predictionId}
      title="Abundance and contribution"
      emptyLabel="No explanation available."
      rowHeight={26}
      showMaxDisplay={false}
      extraControls={
        // The switch's name is two words, so what it does lives behind an
        // info icon beside it. The icon is the trigger, not the label, so
        // clicking the words still toggles the box. The app's own Tooltip
        // rather than a title attribute: that one waits a second, cannot be
        // styled, and never appears on a touch screen. The provider is local
        // because the sidebar's does not reach this far.
        <span className="flex items-center gap-1.5 whitespace-nowrap border-l pl-3 text-sm text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={colorByInteraction}
              onChange={(event) => setColorByInteraction(event.target.checked)}
              className="accent-primary"
            />
            Interaction mode
          </label>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="What interaction mode does"
                  className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <InformationCircleIcon aria-hidden="true" className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs [text-wrap:pretty]">
                Colours each dot by how much of the taxon that interacts most with the selected
                one a sample had, instead of by the sample&apos;s predicted probability.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
      }
    >
      {({ explanation, groupByGenus, width }) => {
        // Rank the taxa the chart will actually draw. Grouping by genus
        // replaces the species columns with genus ones, so ranking the
        // ungrouped names would offer a name the chart cannot find.
        const raw = parseExplanation(explanation);
        const parsed = groupByGenus ? groupExplanationByGenus(raw) : raw;
        const ranked = orderFeatures(globalImportance(parsed)).map(
          (index) => parsed.featureNames[index],
        );
        const selected = feature && ranked.includes(feature) ? feature : ranked[0];

        return (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span id={selectId}>Taxon</span>
              <select
                aria-labelledby={selectId}
                value={selected}
                onChange={(event) => setFeature(event.target.value)}
                className={`${nativeControl} max-w-[28rem] flex-1`}
              >
                {ranked.map((name) => (
                  <option key={name} value={name}>
                    {name.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <Plots.scatter
              explanation={explanation}
              labels={RESEARCH_LABELS}
              feature={selected}
              colorFeature={colorByInteraction ? "auto" : "output"}
              groupByGenus={groupByGenus}
              width={width}
              height={Math.round(width * 0.55)}
              onSampleClick={setPeek}
            />
            <SampleDialog
              predictionId={predictionId}
              explanation={explanation}
              sampleIndex={peek}
              onOpenChange={(open) => !open && setPeek(null)}
            />
          </div>
        );
      }}
    </ChartFrame>
  );
}

/**
 * Every sample placed by *why* the model decided about it.
 *
 * The axes are a two-component PCA of the contributions themselves, not of the
 * abundances, so samples the model judged for the same reasons sit together.
 */
export function GlobalEmbeddingChart({ predictionId }: { predictionId?: string }) {
  const [peek, setPeek] = useState<number | null>(null);

  return (
    <ChartFrame
      predictionId={predictionId}
      title="Explanation map"
      emptyLabel="No explanation available."
      rowHeight={26}
      showMaxDisplay={false}
    >
      {({ explanation, groupByGenus, width }) => (
        <>
          <Plots.embedding
            explanation={explanation}
            labels={RESEARCH_LABELS}
            groupByGenus={groupByGenus}
            width={width}
            height={Math.round(width * 0.6)}
            onSampleClick={setPeek}
          />
          <SampleDialog
            predictionId={predictionId}
            explanation={explanation}
            sampleIndex={peek}
            onOpenChange={(open) => !open && setPeek(null)}
          />
        </>
      )}
    </ChartFrame>
  );
}

/** The waterfall compressed onto one line: what raised this sample's prediction and what lowered it. */
export function LocalForceChart({
  predictionId,
  recordId,
}: {
  predictionId?: string;
  recordId?: string;
}) {
  return (
    <ChartFrame
      predictionId={predictionId}
      title="Contributions at a glance"
      emptyLabel="No explanation available for this prediction."
      rowHeight={26}
    >
      {({ explanation, maxDisplay, groupByGenus, width }) => {
        const sampleIndex = sampleIndexOf(explanation, recordId);
        if (sampleIndex < 0) {
          return (
            <div className="py-2 text-sm text-muted-foreground">
              This record is not in the prediction&apos;s explanation.
            </div>
          );
        }
        return (
          <Plots.force
            explanation={explanation}
            labels={RESEARCH_LABELS}
            groupByGenus={groupByGenus}
            sampleIndex={sampleIndex}
            maxDisplay={maxDisplay}
            width={width}
            height={110}
          />
        );
      }}
    </ChartFrame>
  );
}
