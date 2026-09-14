import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/router";
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
} from "@heroicons/react/24/outline";

import Layout from "@/components/common/Layout";
import { PageHeader } from "@/components/common/PageHeader";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModelLink } from "@/components/experiments/ModelLink";
import { StatusBadge } from "@/components/prediction/StatusBadge";
import {
  IPredictionRecords,
  IPredictionsPagination,
  PredictionClass,
  PredictionStatus,
} from "@/components/model/model.interface";
import { IPaginationRequestParams } from "@/components/model/pagination.interface";
import { Pagination } from "@/components/ui/Pagination";
import { LocalWaterfallChart } from "@/components/shap/ExplanationCharts";
import { ChartSection } from "@/components/shap/ChartSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { classLabel } from "@/lib/classes";
import { displayValue, formatPercent } from "@/lib/format";
import { notifyError, notifySuccess } from "@/lib/notify";
import { queryToString } from "@/lib/queryToString";
import { useSse } from "@/lib/useSse";
import {
  invalidateExplanation,
  revalidateExplanation,
  setExplanationProgress,
} from "@/lib/useExplanation";
import {
  getPredictionRecords,
  patchPredictionRecordsComment,
  postCancelPredict,
  postRePredict,
} from "../api/predict";

const CLASS_FILTERS = [
  { value: PredictionClass.ALL, label: "All" },
  { value: PredictionClass.POSITIVE, label: "Positive" },
  { value: PredictionClass.NEGATIVE, label: "Negative" },
];

const STATUS_FILTERS = [
  { value: PredictionStatus.ALL, label: "All" },
  { value: PredictionStatus.SUCCESS, label: "Success" },
  { value: PredictionStatus.PENDING, label: "Pending" },
  { value: PredictionStatus.IN_PROGRESS, label: "In Progress" },
  { value: PredictionStatus.CANCELED, label: "Canceled" },
  { value: PredictionStatus.ERROR, label: "Error" },
];

function usePredictionClass(): PredictionClass {
  const router = useRouter();
  const { class: queryClass } = router.query;

  if (
    typeof queryClass === "string" &&
    Object.values(PredictionClass).includes(queryClass as PredictionClass)
  ) {
    return queryClass as PredictionClass;
  }

  return PredictionClass.ALL;
}

function usePredictionStatus(): PredictionStatus {
  const router = useRouter();
  const { status: queryStatus } = router.query;

  if (
    typeof queryStatus === "string" &&
    Object.values(PredictionStatus).includes(queryStatus as PredictionStatus)
  ) {
    return queryStatus as PredictionStatus;
  }

  return PredictionStatus.ALL;
}

/** One wording for the predicted class, in the table and the drawer alike. */
function classificationLabel(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  return `Probable ${classLabel(value).toLowerCase()}`;
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="text-sm text-muted-foreground">
        {label}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-labelledby={labelId}
        value={value}
        // Radix reports "" when the pressed item is pressed again; a filter
        // always has a value, so that click changes nothing.
        onValueChange={(next) => next && onChange(next as T)}
        className="flex-wrap justify-start"
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

const SampleDataTable = ({ record }: { record: IPredictionRecords }) => {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();

  const columns =
    record.dfColumns
      ?.map((col, index) => ({ col, index }))
      .filter(({ col }) => col.toLowerCase().includes(query)) ?? [];

  return (
    <section aria-labelledby="sample-data-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="sample-data-heading" className="text-base font-semibold">
            Sample Data
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The relative abundance of each taxon, as uploaded.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Label htmlFor="taxon-search" className="sr-only">
            Search taxa
          </Label>
          <Input
            id="taxon-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search taxa…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>
      {columns.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          No taxa match “{filter}”.
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map(({ col, index }) => (
                  <TableHead key={`${col}-${index}`} className="whitespace-nowrap italic">
                    {col.replaceAll("_", " ")}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="hover:bg-transparent">
                {columns.map(({ index }) => (
                  <TableCell key={index} className="whitespace-nowrap tabular-nums">
                    {displayValue(record.dfData?.[index])}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
};

export function PredictionRecordsPage() {
  const router = useRouter();
  const [predictions, setPredictions] = useState<IPredictionsPagination>();
  const [isOpen, setIsOpen] = useState(false);
  const [selectPrediction, setSelectPrediction] = useState<IPredictionRecords>();
  const [diagnosisComment, setDiagnosisComment] = useState<string>();
  const [saveCommentLoading, setSaveCommentLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const predictionClass = usePredictionClass();
  const predictionStatus = usePredictionStatus();

  const [openCancelModal, setOpenCancelModal] = useState(false);
  const [openReJobModal, setOpenReJobModal] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const predictionId = router.query.id as string;
  const currentPage = Number(router.query.page) || 1;
  const filtered =
    predictionClass !== PredictionClass.ALL || predictionStatus !== PredictionStatus.ALL;

  const replaceQuery = (changes: Record<string, string | number>) => {
    const params = {
      id: predictionId,
      page: currentPage,
      class: predictionClass,
      status: predictionStatus,
      ...changes,
    };
    router.replace(`?${queryToString(params)}`, undefined, { shallow: true });
  };

  const getPredictionsList = async () => {
    if (!predictionId) return undefined;
    const params: IPaginationRequestParams = {
      page: currentPage,
      class: predictionClass,
      status: predictionStatus,
    };
    const data = await getPredictionRecords(predictionId, params);
    setPredictions(data);
    return data;
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await getPredictionsList();
    } finally {
      setRefreshing(false);
    }
  };

  // Patch one record in both the open drawer and its table row, so the two
  // never drift apart (after an SSE update or a saved comment).
  const patchRecord = (id: string, patch: Partial<IPredictionRecords>) => {
    setSelectPrediction((prev) =>
      prev && prev.id === id ? { ...prev, ...patch } : prev
    );
    setPredictions((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
          }
        : prev
    );
  };

  const onOpenPrediction = (prediction: IPredictionRecords) => {
    setSelectPrediction(prediction);
    setDiagnosisComment(prediction.comment);
    setIsOpen(true);
  };

  const commentDirty =
    isOpen && (diagnosisComment ?? "") !== (selectPrediction?.comment ?? "");

  // Closing the drawer would throw an unsaved comment away, so ask first.
  const onSheetOpenChange = (open: boolean) => {
    if (open) return;
    if (commentDirty) setConfirmDiscard(true);
    else setIsOpen(false);
  };

  useEffect(() => {
    if (!commentDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [commentDirty]);

  const onConfirmRepredict = async () => {
    await postRePredict(predictionId);
    await getPredictionsList();
    notifySuccess("Failed Jobs Restarted", "They run again with the same input and model.");
  };

  const onConfirmCancel = async () => {
    await postCancelPredict(predictionId);
    await getPredictionsList();
    notifySuccess("In-Progress Jobs Canceled");
  };

  const onSaveComment = async () => {
    if (!selectPrediction?.id) return;
    setSaveCommentLoading(true);
    try {
      await patchPredictionRecordsComment(
        predictionId,
        selectPrediction.id,
        diagnosisComment
      );
      // Reflect the saved comment in both the drawer's selected record and the
      // table row so the user doesn't see stale text.
      patchRecord(selectPrediction.id, { comment: diagnosisComment ?? "" });
      notifySuccess("Comment Saved");
    } catch {
      notifyError("Couldn’t Save Comment", "Your text is still here. Try saving again in a moment.");
    } finally {
      setSaveCommentLoading(false);
    }
  };

  // Re-fetch whenever the URL-driven query (page / class / status) changes.
  // Previously this only fired on mount, so the table never refreshed when
  // the user clicked a tab or paginated.
  useEffect(() => {
    getPredictionsList();
  }, [predictionId, currentPage, predictionClass, predictionStatus]);

  // Live updates from the backend: as each record transitions
  // PENDING -> IN_PROGRESS -> SUCCESS/ERROR/CANCELED, the processor emits a
  // 'record:update' event and we patch the matching row in place. Avoids
  // the "click Refresh repeatedly" workflow this page used to require.
  useSse(predictionId ? `/events/predictions/${predictionId}` : null, {
    // SSE has no event replay: any 'record:update' emitted while the socket
    // was down is lost. Re-fetch once on every (re)connect so the table is
    // reconciled with the server before we start applying live patches.
    onOpen() {
      getPredictionsList().then((data) => {
        if (!data) return;
        // The open drawer holds its own copy of the record; reconcile it too.
        setSelectPrediction((prev) =>
          prev ? data.items.find((it) => it.id === prev.id) ?? prev : prev
        );
      });
      // An explanation finished or rebuilt while the socket was down.
      if (predictionId) revalidateExplanation(predictionId);
    },
    onMessage(ev) {
      if (!ev.data) return;
      try {
        const payload = JSON.parse(ev.data);
        if (ev.event === "record:update") {
          // Patches the table row and the open drawer together.
          patchRecord(payload.id, payload);
        }
        // The waterfall reads the explanation over HTTP, so these two events
        // only have to say when to look again, and how far along it is.
        if (ev.event === "prediction:explanation" && predictionId) {
          invalidateExplanation(predictionId);
        } else if (ev.event === "prediction:explanation-progress" && predictionId) {
          setExplanationProgress(predictionId, {
            done: payload.done,
            total: payload.total,
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[prediction SSE] bad payload:", err);
      }
    },
  });

  const prediction = predictions?.prediction;
  const items = predictions?.items;
  const record = selectPrediction;

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        leading={
          <Link href="/prediction/prediction" passHref>
            <Button asChild variant="ghost" size="icon" className="-ml-2 shrink-0">
              <a aria-label="Back to prediction list">
                <ChevronLeftIcon aria-hidden="true" />
              </a>
            </Button>
          </Link>
        }
        title={prediction ? `Prediction ${prediction.predictionNumber}` : "Prediction"}
        description={
          prediction ? (
            <>
              Model:{" "}
              <ModelLink name={prediction.modelName} version={prediction.modelVersion} />
            </>
          ) : (
            <Skeleton className="mt-1 h-4 w-48" />
          )
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              {refreshing ? <Spinner /> : <ArrowPathIcon aria-hidden="true" />}
              Refresh
            </Button>
            {/* Not modal: a modal menu would still hold focus as the
                confirmation it opens tries to take it. */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" aria-label="More actions">
                  <EllipsisHorizontalIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => setOpenReJobModal(true)}>
                    Re-run Failed Jobs…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setOpenCancelModal(true)}
                  >
                    Cancel In-Progress Jobs…
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <FilterGroup
          label="Classification"
          value={predictionClass}
          options={CLASS_FILTERS}
          onChange={(value) => replaceQuery({ page: 1, class: value })}
        />
        <FilterGroup
          label="Status"
          value={predictionStatus}
          options={STATUS_FILTERS}
          onChange={(value) => replaceQuery({ page: 1, status: value })}
        />
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sample</TableHead>
                <TableHead className="text-right">Probability</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items ? (
                Array.from({ length: 8 }, (_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 4 }, (_, cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="p-0">
                    <Empty className="py-16">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <FunnelIcon aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>{filtered ? "No Records Match" : "No Records Yet"}</EmptyTitle>
                        <EmptyDescription>
                          {filtered
                            ? "No sample has this classification and status. Try another filter."
                            : "This prediction has no samples to show yet."}
                        </EmptyDescription>
                      </EmptyHeader>
                      {filtered && (
                        <EmptyContent>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              replaceQuery({
                                page: 1,
                                class: PredictionClass.ALL,
                                status: PredictionStatus.ALL,
                              })
                            }
                          >
                            Clear Filters
                          </Button>
                        </EmptyContent>
                      )}
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  // The row is a large click target for the mouse; the button
                  // in its first cell is the same action for the keyboard.
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => onOpenPrediction(item)}
                  >
                    <TableCell>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenPrediction(item);
                        }}
                        className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.record_number}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(item.proba)}
                    </TableCell>
                    <TableCell>{classificationLabel(item.class)}</TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
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
          onChange={(page) => replaceQuery({ page })}
        />
      </div>

      <Sheet open={isOpen} onOpenChange={onSheetOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-4xl">
          <SheetHeader className="space-y-1 border-b px-6 py-4 pr-14 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle>Sample {record?.record_number}</SheetTitle>
              <StatusBadge status={record?.status} />
            </div>
            <SheetDescription>
              Probability {formatPercent(record?.proba)} · {classificationLabel(record?.class)}
            </SheetDescription>
          </SheetHeader>

          <div
            key={record?.id}
            className="flex flex-1 flex-col gap-8 overflow-y-auto overscroll-contain px-6 py-6"
          >
            {record?.status === PredictionStatus.ERROR && (
              <Alert variant="destructive">
                <ExclamationTriangleIcon aria-hidden="true" className="size-4" />
                <AlertTitle>This Sample Failed</AlertTitle>
                <AlertDescription>
                  {record.errorMsg ??
                    "The job stopped without saying why. Re-run failed jobs from the page’s More actions menu."}
                </AlertDescription>
              </Alert>
            )}
            {record?.status === PredictionStatus.CANCELED && (
              <Alert>
                <ExclamationTriangleIcon aria-hidden="true" className="size-4" />
                <AlertTitle>This Sample Was Canceled</AlertTitle>
                <AlertDescription>
                  {record.errorMsg ??
                    "It was stopped before it finished. Re-run failed jobs from the page’s More actions menu."}
                </AlertDescription>
              </Alert>
            )}

            <ChartSection
              id="contribution-breakdown"
              title="Contribution Breakdown"
              description="How this sample’s taxa move the prediction from the model’s average to its final output. Red pushes the prediction up and blue pushes it down; the bars add up to the difference."
            >
              <LocalWaterfallChart predictionId={predictionId} recordId={record?.id} />
            </ChartSection>

            <Separator />

            <section aria-labelledby="diagnosis-heading" className="flex flex-col gap-3">
              <h2 id="diagnosis-heading" className="text-base font-semibold">
                Diagnosis Comment
              </h2>
              <Field>
                <FieldLabel htmlFor="diagnosis-comment" className="sr-only">
                  Diagnosis comment
                </FieldLabel>
                <Textarea
                  id="diagnosis-comment"
                  rows={5}
                  className="resize-y"
                  placeholder="Your diagnosis, interpretation or other notes on this sample…"
                  value={diagnosisComment ?? ""}
                  onChange={(event) => setDiagnosisComment(event.target.value)}
                />
                <FieldDescription>
                  {commentDirty ? "Unsaved changes." : "Saved with this sample."}
                </FieldDescription>
              </Field>
              <div className="flex justify-end">
                <Button
                  onClick={onSaveComment}
                  disabled={saveCommentLoading || !commentDirty}
                >
                  {saveCommentLoading && <Spinner />}
                  {saveCommentLoading ? "Saving…" : "Save Comment"}
                </Button>
              </div>
            </section>

            {record?.dfColumns && record?.dfData && (
              <>
                <Separator />
                <SampleDataTable record={record} key={record.id} />
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={openCancelModal}
        onOpenChange={setOpenCancelModal}
        destructive
        title="Cancel In-Progress Jobs?"
        description="Jobs that are running now stop straight away and are marked as canceled. This can’t be undone, though you can re-run them afterwards."
        cancelLabel="Keep Running"
        confirmLabel="Cancel Jobs"
        pendingLabel="Canceling…"
        errorTitle="Couldn’t Cancel Jobs"
        onConfirm={onConfirmCancel}
      />
      <ConfirmDialog
        open={openReJobModal}
        onOpenChange={setOpenReJobModal}
        title="Re-run Failed Jobs?"
        description="Jobs that failed or were canceled start again with the same input data and model."
        confirmLabel="Re-run Jobs"
        pendingLabel="Restarting…"
        errorTitle="Couldn’t Re-run Jobs"
        onConfirm={onConfirmRepredict}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        destructive
        title="Discard Unsaved Comment?"
        description="You changed this sample’s diagnosis comment without saving it."
        cancelLabel="Keep Editing"
        confirmLabel="Discard"
        pendingLabel="Discarding…"
        errorTitle="Couldn’t Close"
        onConfirm={() => {
          setDiagnosisComment(selectPrediction?.comment);
          setIsOpen(false);
        }}
      />
    </div>
  );
}

PredictionRecordsPage.Layout = Layout;
PredictionRecordsPage.title = "Prediction Records";
export default PredictionRecordsPage;
