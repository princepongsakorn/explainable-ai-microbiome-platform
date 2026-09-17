import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { ChevronRightIcon, TableCellsIcon } from "@heroicons/react/24/outline";

import Layout from "@/components/common/Layout";
import { PageHeader } from "@/components/common/PageHeader";
import { RowOpenButton } from "@/components/common/RowOpenButton";
import { ModelLink } from "@/components/experiments/ModelLink";
import { IPredictionSummary, IPredictions } from "@/components/model/model.interface";
import { IPagination } from "@/components/model/pagination.interface";
import { Pagination } from "@/components/ui/Pagination";
import {
  GlobalBeeswarmChart,
  GlobalDependenceChart,
  GlobalEmbeddingChart,
  GlobalHeatmapChart,
  GlobalImportanceChart,
} from "@/components/shap/ExplanationCharts";
import { ChartSection } from "@/components/shap/ChartSection";
import { PredictionProgress } from "@/components/prediction/PredictionProgress";
import { PredictionResults } from "@/components/prediction/PredictionResults";
import { PredictionSummary } from "@/components/prediction/PredictionSummary";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { formatDateTime } from "@/lib/format";
import { queryToString } from "@/lib/queryToString";
import { useSse } from "@/lib/useSse";
import {
  invalidateExplanation,
  revalidateExplanation,
  setExplanationProgress,
} from "@/lib/useExplanation";
import { getPredictionSummary, getPredictions } from "../api/predict";

// While a prediction on the page is still running, look again this often.
const LIST_POLL_INTERVAL_MS = 15_000;

export function PredictionListPage() {
  const router = useRouter();
  const [predictions, setPredictions] = useState<IPagination<IPredictions>>();
  const [isOpen, setIsOpen] = useState(false);
  const [selectPrediction, setSelectPrediction] = useState<IPredictions>();
  // undefined while loading, null if it failed.
  const [summary, setSummary] = useState<IPredictionSummary | null>();

  const currentPage = Number(router.query.page) || 1;

  const getPredictionsRecordList = async () => {
    const data = await getPredictions({ page: currentPage });
    setPredictions(data);
    return data;
  };

  const loadSummary = () =>
    getPredictionSummary()
      .then(setSummary)
      .catch(() => setSummary(null));

  // Live heatmap/beeswarm updates while the drawer is open on a prediction.
  useSse(
    isOpen && selectPrediction?.id
      ? `/events/predictions/${selectPrediction.id}`
      : null,
    {
      // SSE has no event replay: a 'prediction:explain' emitted while the
      // socket was down is lost. Re-fetch on (re)connect and reconcile the
      // open drawer from the fresh list.
      onOpen() {
        getPredictionsRecordList().then((data) => {
          setSelectPrediction((prev) => {
            if (!prev) return prev;
            return data.items.find((it) => it.id === prev.id) ?? prev;
          });
        });
        // An explanation finished or rebuilt while the socket was down.
        if (selectPrediction?.id) revalidateExplanation(selectPrediction.id);
      },
      onMessage(ev) {
        if (!ev.data) return;
        try {
          const payload = JSON.parse(ev.data);
          const id = selectPrediction?.id;
          if (!id) return;
          // The charts read the explanation over HTTP, so the only thing these
          // events have to do is say when to look again.
          if (ev.event === "prediction:explanation") {
            invalidateExplanation(id);
          } else if (ev.event === "prediction:explanation-progress") {
            setExplanationProgress(id, {
              done: payload.done,
              total: payload.total,
            });
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[prediction SSE] bad payload:", err);
        }
      },
    }
  );

  const onHandleChangePage = (page: number) => {
    router.push({ query: { ...router.query, page } }, undefined, { shallow: true });
  };

  const openPrediction = (prediction: IPredictions) => {
    setSelectPrediction(prediction);
    setIsOpen(true);
  };

  // Re-fetch when the page changes. Previously this only ran on mount, so
  // paginating left the table showing the first page's data.
  useEffect(() => {
    getPredictionsRecordList();
  }, [currentPage]);

  useEffect(() => {
    loadSummary();
  }, []);

  const hasActiveWork =
    predictions?.items.some(
      (item) =>
        (item.records.byStatus?.PENDING ?? 0) + (item.records.byStatus?.IN_PROGRESS ?? 0) > 0
    ) ?? false;

  // Poll only while something on this page is still running, and not while
  // the tab is hidden.
  useEffect(() => {
    if (!hasActiveWork) return;
    const intervalId = setInterval(() => {
      if (document.hidden) return;
      getPredictionsRecordList();
      loadSummary();
    }, LIST_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [hasActiveWork, currentPage]);

  const items = predictions?.items;

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Prediction List"
        description="Every uploaded file and the model that predicted it. Open one to see what drove its predictions."
      />

      <PredictionSummary summary={summary} />

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prediction</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Results</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items ? (
                Array.from({ length: 5 }, (_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 5 }, (_, cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <Empty className="py-16">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <TableCellsIcon aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>No Predictions Yet</EmptyTitle>
                        <EmptyDescription>
                          Upload a CSV of samples to create your first prediction.
                        </EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Link href="/upload/predict" passHref>
                          <Button asChild size="sm">
                            <a>Upload File</a>
                          </Button>
                        </Link>
                      </EmptyContent>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((prediction) => (
                  <TableRow
                    key={prediction.id}
                    className="cursor-pointer"
                    onClick={() => openPrediction(prediction)}
                  >
                    <TableCell>
                      <RowOpenButton onOpen={() => openPrediction(prediction)}>
                        {prediction.predictionNumber}
                      </RowOpenButton>
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate">
                      {prediction.modelName}
                    </TableCell>
                    <TableCell>
                      <PredictionProgress records={prediction.records} />
                    </TableCell>
                    <TableCell>
                      <PredictionResults byClass={prediction.records.byClass} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateTime(prediction.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <Pagination
          currentPage={currentPage}
          itemsPerPage={predictions?.meta.itemsPerPage || 0}
          totalItems={predictions?.meta.totalItems || 0}
          totalPages={predictions?.meta.totalPages || 0}
          itemCount={predictions?.meta.itemCount || 0}
          onChange={onHandleChangePage}
        />
      </div>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-4xl">
          <SheetHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b px-6 py-4 pr-14 text-left">
            <div className="min-w-0">
              <SheetTitle>Prediction {selectPrediction?.predictionNumber}</SheetTitle>
              <SheetDescription>
                {selectPrediction && (
                  <ModelLink
                    name={selectPrediction.modelName}
                    version={selectPrediction.modelVersion}
                  />
                )}{" "}
                · {selectPrediction?.records.total} samples ·{" "}
                {formatDateTime(selectPrediction?.createdAt)}
              </SheetDescription>
            </div>
            {selectPrediction && (
              <Link
                href={`/prediction/local?${queryToString({ id: selectPrediction.id })}`}
                passHref
              >
                <Button asChild variant="outline" size="sm">
                  <a>
                    View All Records
                    <ChevronRightIcon aria-hidden="true" />
                  </a>
                </Button>
              </Link>
            )}
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-8 overflow-y-auto overscroll-contain px-6 py-6">
            <ChartSection
              id="feature-importance"
              title="Feature Importance"
              description="Mean absolute contribution of each taxon across every sample in this prediction: how much it moved the model, whichever the direction. Change how many are shown without recomputing anything."
            >
              <GlobalImportanceChart predictionId={selectPrediction?.id} />
            </ChartSection>
            <Separator />
            <ChartSection
              id="beeswarm"
              title="Beeswarm"
              description="One dot per sample per taxon. Horizontal position is that sample’s contribution; colour is its relative abundance, scaled within the row so a single dominant taxon cannot wash out the others. Hover a dot for its values."
            >
              <GlobalBeeswarmChart predictionId={selectPrediction?.id} />
            </ChartSection>
            <Separator />
            <ChartSection
              id="heatmap"
              title="Heatmap"
              description="Every sample as a column and every taxon as a row, coloured by contribution: white at zero, red above, blue below. Samples are ordered by total contribution, so similar explanations sit together. Hover a column to see which sample it is."
            >
              <GlobalHeatmapChart predictionId={selectPrediction?.id} />
            </ChartSection>
            <Separator />
            <ChartSection
              id="dependence"
              title="Abundance and Contribution"
              description="One taxon at a time: how much of it a sample had, against how much it moved that sample’s prediction. Samples where it was not detected sit in their own band at the left, because a zero is a real absence rather than a small number. The line through the cloud is the median, which shows whether more is always worse or whether there is a level below which it stops mattering."
            >
              <GlobalDependenceChart predictionId={selectPrediction?.id} />
            </ChartSection>
            <Separator />
            <ChartSection
              id="explanation-map"
              title="Explanation Map"
              description="Samples placed by why the model decided about them, not by what they contained: the axes are a two-component summary of the contributions themselves. Samples judged for the same reasons sit together, so a cluster here is a group the model reasoned about alike."
            >
              <GlobalEmbeddingChart predictionId={selectPrediction?.id} />
            </ChartSection>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

PredictionListPage.Layout = Layout;
PredictionListPage.title = "Prediction List";
export default PredictionListPage;
