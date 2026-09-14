import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  BeakerIcon,
  ChevronDownIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";

import Layout from "@/components/common/Layout";
import { PageHeader } from "@/components/common/PageHeader";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  getExperimentsList,
  getExperimentsById,
  getRunById,
  putPublicModelByRunId,
  putUnPublicModelByRunId,
  postDescriptionExperiments,
} from "../api/experiments";
import { getModelsType } from "../api/model";
import {
  IExperiment,
  IExperimentsRunResponse,
  IRun,
  IRunDetail,
} from "@/components/model/experiments.interface";
import { IModelType } from "@/components/model/model.interface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  displayValue,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "@/lib/format";
import { notifyError, notifySuccess } from "@/lib/notify";
import { cn } from "@/lib/utils";

type SortOrder = "ASC" | "DESC";

// Auto-refresh interval for the runs table. Training is triggered outside
// this service (MLflow notebooks), so there's no in-process event to push
// over SSE — a lightweight poll is the pragmatic choice here.
const RUNS_POLL_INTERVAL_MS = 15_000;

const isPublished = (run?: IRunDetail) => run?.models?.[0]?.current_stage === "Production";

const PublishDialog = (props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublish: (data: { model: IModelType; description: string }) => Promise<void>;
}) => {
  const [modelTypes, setModelTypes] = useState<IModelType[]>();
  const [typeId, setTypeId] = useState<string>();
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ type?: string; description?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setTypeId(undefined);
    setDescription("");
    setErrors({});
    if (!modelTypes) {
      getModelsType()
        .then(setModelTypes)
        .catch(() => setModelTypes([]));
    }
  }, [props.open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const model = modelTypes?.find((type) => type.id === typeId);
    const next = {
      type: model ? undefined : "Choose what this model predicts.",
      description: description.trim()
        ? undefined
        : "Describe the model so others know when to use it.",
    };
    setErrors(next);
    if (!model || next.description) return;

    setPending(true);
    try {
      await props.onPublish({ model, description: description.trim() });
      props.onOpenChange(false);
    } catch {
      notifyError("Couldn’t Publish Model", "Nothing was changed. Try again in a moment.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !pending && props.onOpenChange(open)}>
      <DialogContent className="sm:max-w-xl">
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Publish Model to Production</DialogTitle>
            <DialogDescription>
              Published models are offered to everyone uploading files for prediction.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-5">
            <Field data-invalid={errors.type ? true : undefined}>
              <FieldLabel htmlFor="publish-model-type">Model type</FieldLabel>
              <Select
                value={typeId}
                onValueChange={(value) => {
                  setTypeId(value);
                  setErrors((prev) => ({ ...prev, type: undefined }));
                }}
                disabled={!modelTypes}
              >
                <SelectTrigger
                  id="publish-model-type"
                  aria-invalid={errors.type ? true : undefined}
                >
                  <SelectValue
                    placeholder={modelTypes ? "Choose what the model predicts…" : "Loading types…"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {modelTypes?.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name} ({type.description})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {errors.type && <FieldError>{errors.type}</FieldError>}
            </Field>
            <Field data-invalid={errors.description ? true : undefined}>
              <FieldLabel htmlFor="publish-description">Description</FieldLabel>
              <Textarea
                id="publish-description"
                rows={4}
                className="resize-y"
                placeholder="Its purpose, training data, or when to use it…"
                aria-invalid={errors.description ? true : undefined}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              {errors.description && <FieldError>{errors.description}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {pending ? "Publishing…" : "Publish Model"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/** A two-column list of names and values, for the run drawer. */
function DetailList({ entries }: { entries: [string, string][] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">None recorded.</p>;
  }
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 text-sm">
      {entries.map(([name, value]) => (
        <div
          key={name}
          className="col-span-2 -mx-2 grid grid-cols-subgrid rounded-md border-b px-2 py-2 transition-colors last:border-b-0 hover:bg-muted"
        >
          <dt className="min-w-0 break-words text-muted-foreground">{name}</dt>
          <dd className="max-w-[20rem] break-all text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Experiments() {
  const [experiments, setExperiments] = useState<IExperiment[]>();
  const [experimentsLoading, setExperimentsLoading] = useState<boolean>(true);
  const [selectedExperiments, setSelectedExperiments] = useState<IExperiment>();
  const [runs, setRuns] = useState<IExperimentsRunResponse>();
  const [runLoading, setRunLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<{ key: string; order: SortOrder }>();
  const [isOpen, setIsOpen] = useState(false);
  const [runInfo, setRunInfo] = useState<IRunDetail>();
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);

  // Description
  const [experimentsDescription, setExperimentsDescription] = useState<string>();
  const [isEditDescription, setIsEditDescription] = useState<boolean>(false);
  const [savingDescription, setSavingDescription] = useState(false);

  // Set once the user clicks "Load more": polling would otherwise collapse
  // the expanded view back to page 1. Reset when the scope changes.
  const loadedMoreRef = useRef(false);
  // The run the drawer was last asked to show, so a slow response for an
  // earlier click cannot replace a later one.
  const requestedRunRef = useRef<string>();

  useEffect(() => {
    const getExperiments = async () => {
      setExperimentsLoading(true);
      setRunLoading(true);
      const data = await getExperimentsList();
      const experiments = data.experiments;
      setExperimentsLoading(false);
      setExperiments(experiments);
      setSelectedExperiments(experiments[0]);
    };
    getExperiments();
  }, []);

  useEffect(() => {
    setExperimentsDescription(selectedExperiments?.tags["mlflow.note.content"]);
    setIsEditDescription(false);
  }, [selectedExperiments]);

  useEffect(() => {
    setRuns(undefined);
    setSort(undefined);
    getExperiment();
  }, [selectedExperiments]);

  useEffect(() => {
    const getExperimentsByIdAndSort = async () => {
      if (sort && selectedExperiments) {
        const orderBy = sort?.key ? `${sort?.key} ${sort?.order}` : "";
        const data = await getExperimentsById(
          selectedExperiments?.experiment_id,
          { pageToken: "", orderBy: orderBy }
        );
        setRuns(data);
      }
    };
    getExperimentsByIdAndSort();
  }, [sort]);

  // Whenever the viewed scope changes, drop the "user paginated" guard so
  // polling resumes for the new experiment / sort order.
  useEffect(() => {
    loadedMoreRef.current = false;
  }, [selectedExperiments, sort]);

  // Poll the runs table so newly-finished training runs surface on their
  // own. Silent on purpose — no skeleton flash — and paused while the tab
  // is hidden or the user has expanded the list via "Load more".
  useEffect(() => {
    if (!selectedExperiments) return;
    const intervalId = setInterval(async () => {
      if (loadedMoreRef.current || document.hidden) return;
      try {
        const orderBy = sort?.key ? `${sort.key} ${sort.order}` : "";
        const data = await getExperimentsById(
          selectedExperiments.experiment_id,
          { pageToken: "", orderBy }
        );
        setRuns(data);
      } catch (err) {
        // Transient failures are fine — the next tick retries.
        // eslint-disable-next-line no-console
        console.warn("[experiments poll] refresh failed:", err);
      }
    }, RUNS_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [selectedExperiments, sort]);

  const getExperiment = async () => {
    if (selectedExperiments) {
      const orderBy = sort?.key ? `${sort?.key} ${sort?.order}` : "";
      setRunLoading(true);
      const data = await getExperimentsById(
        selectedExperiments?.experiment_id,
        { pageToken: "", orderBy: orderBy }
      );
      setRunLoading(false);
      setRuns(data);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await getExperiment();
    } finally {
      setRefreshing(false);
    }
  };

  const cancelDescriptionEdit = () => {
    setExperimentsDescription(selectedExperiments?.tags["mlflow.note.content"]);
    setIsEditDescription(false);
  };

  const updateDescriptionExperiments = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedExperiments) return;
    setSavingDescription(true);
    try {
      await postDescriptionExperiments(
        selectedExperiments.experiment_id,
        experimentsDescription
      );
      // Re-sync experiment list so the new description is what the
      // server actually persisted (trimmed, sanitized, etc.).
      const data = await getExperimentsList();
      const refreshed = data.experiments.find(
        (e) => e.experiment_id === selectedExperiments.experiment_id
      );
      setExperiments(data.experiments);
      if (refreshed) {
        setSelectedExperiments(refreshed);
      }
      setIsEditDescription(false);
      notifySuccess("Description Saved");
    } catch {
      notifyError("Couldn’t Save Description", "Your text is still here. Try again in a moment.");
    } finally {
      setSavingDescription(false);
    }
  };

  const loadMoreHandle = async () => {
    if (selectedExperiments && runs?.nextPageToken) {
      setLoadingMore(true);
      try {
        const orderBy = sort?.key ? `${sort?.key} ${sort?.order}` : "";
        const data = await getExperimentsById(selectedExperiments?.experiment_id, {
          pageToken: runs?.nextPageToken,
          orderBy,
        });
        const runsLoadMore: IExperimentsRunResponse = {
          runs: [...runs.runs, ...data.runs],
          nextPageToken: data.nextPageToken,
        };
        setRuns(runsLoadMore);
        // Pause polling — a silent refresh would discard these extra rows.
        loadedMoreRef.current = true;
      } finally {
        setLoadingMore(false);
      }
    }
  };

  const handleSort = (col: string) => {
    if (sort?.key === col) {
      setSort({ key: col, order: sort.order === "DESC" ? "ASC" : "DESC" });
    } else {
      setSort({ key: col, order: "DESC" });
    }
  };

  // Opens straight away and fills in when the run arrives, so the click is
  // answered even on a slow MLflow.
  const loadRunInfo = async (id: string) => {
    requestedRunRef.current = id;
    setRunInfo(undefined);
    setIsOpen(true);
    try {
      const run = await getRunById(id);
      if (requestedRunRef.current === id && run.run) {
        setRunInfo(run.run);
      }
    } catch {
      if (requestedRunRef.current === id) {
        setIsOpen(false);
        notifyError("Couldn’t Open Run", "MLflow didn’t answer. Try again in a moment.");
      }
    }
  };

  // Refresh the drawer's run info in place, without forcing the drawer open.
  // Used after publish/unpublish so the button state reflects the new stage.
  const refreshRunInfo = async (id: string) => {
    const run = await getRunById(id);
    if (run.run) {
      setRunInfo(run.run);
    }
  };

  const publishModel = async (data: { model: IModelType; description: string }) => {
    const id = runInfo?.info.run_id;
    if (!id) return;
    await putPublicModelByRunId(id, data);
    // Refresh the drawer (so the button flips to "Unpublish")
    // and the runs table (so the stage column updates).
    await Promise.all([refreshRunInfo(id), getExperiment()]);
    notifySuccess("Model Published", "It is now offered when uploading files.");
  };

  const unPublishModel = async () => {
    const id = runInfo?.info.run_id;
    if (!id) return;
    await putUnPublicModelByRunId(id);
    await Promise.all([refreshRunInfo(id), getExperiment()]);
    notifySuccess("Model Unpublished");
  };

  const collectKeys = (runs: IRun[] | undefined, field: "metrics" | "parameters") => {
    const keys = new Set<string>();
    runs?.forEach((run) => Object.keys(run.data[field]).forEach((key) => keys.add(key)));
    return Array.from(keys);
  };

  const metricsHeaders = collectKeys(runs?.runs, "metrics");
  const parametersHeaders = collectKeys(runs?.runs, "parameters");

  const sortableHead = (label: string, sortKey: string) => {
    const active = sort?.key === sortKey;
    const Icon = !active
      ? ChevronUpDownIcon
      : sort?.order === "DESC"
      ? ChevronDownIcon
      : ChevronUpIcon;
    return (
      <TableHead
        key={sortKey}
        aria-sort={active ? (sort?.order === "DESC" ? "descending" : "ascending") : undefined}
        className={cn("whitespace-nowrap bg-muted text-right", active && "text-foreground")}
      >
        <button
          type="button"
          onClick={() => handleSort(sortKey)}
          className="inline-flex items-center gap-1 rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
          <Icon aria-hidden="true" className={cn("size-4", !active && "opacity-40")} />
        </button>
      </TableHead>
    );
  };

  const sortedCell = (sortKey: string) => sort?.key === sortKey && "bg-muted/60";

  const onDescriptionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelDescriptionEdit();
    }
  };

  const model = runInfo?.models?.[0];
  const columnCount = 4 + metricsHeaders.length + parametersHeaders.length;

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Experiments"
        description="Training runs logged to MLflow. Open a run to review it and publish its model."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing || !selectedExperiments}
          >
            {refreshing ? <Spinner /> : <ArrowPathIcon aria-hidden="true" />}
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <nav aria-label="Experiments" className="flex w-full shrink-0 flex-col gap-1 lg:w-60">
          <h2 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Experiments
          </h2>
          {experimentsLoading ? (
            Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="mx-2 my-1.5 h-5" />
            ))
          ) : (
            <ul className="flex flex-col gap-0.5">
              {experiments?.map((experiment) => {
                const selected = experiment.experiment_id === selectedExperiments?.experiment_id;
                return (
                  <li key={experiment.experiment_id}>
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      onClick={() => setSelectedExperiments(experiment)}
                      className={cn(
                        "w-full truncate rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected ? "bg-accent font-medium text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {experiment.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {experimentsLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">{selectedExperiments?.name}</h2>
              {isEditDescription ? (
                <form
                  onSubmit={updateDescriptionExperiments}
                  className="flex flex-wrap items-center gap-2"
                >
                  <Label htmlFor="experiment-description" className="sr-only">
                    Experiment description
                  </Label>
                  <Input
                    id="experiment-description"
                    autoComplete="off"
                    // Focus follows the click on "Edit Description".
                    autoFocus
                    placeholder="What this experiment is for…"
                    value={experimentsDescription ?? ""}
                    onChange={(e) => setExperimentsDescription(e.target.value)}
                    onKeyDown={onDescriptionKeyDown}
                    className="max-w-xl flex-1"
                  />
                  <Button type="submit" size="sm" disabled={savingDescription}>
                    {savingDescription && <Spinner />}
                    {savingDescription ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={savingDescription}
                    onClick={cancelDescriptionEdit}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={cn(
                      "text-sm",
                      experimentsDescription ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {experimentsDescription || "No description."}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-muted-foreground"
                    onClick={() => setIsEditDescription(true)}
                  >
                    <PencilSquareIcon aria-hidden="true" />
                    {experimentsDescription ? "Edit Description" : "Add Description"}
                  </Button>
                </div>
              )}
            </div>
          )}

          <Table containerClassName="max-h-[calc(100vh-320px)] rounded-lg border">
            <TableHeader className="sticky top-0 z-10">
              {(metricsHeaders.length > 0 || parametersHeaders.length > 0) && (
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 z-20 bg-muted" />
                  <TableHead colSpan={3} className="bg-muted" />
                  {metricsHeaders.length > 0 && (
                    <TableHead colSpan={metricsHeaders.length} className="border-l bg-muted text-center">
                      Metrics
                    </TableHead>
                  )}
                  {parametersHeaders.length > 0 && (
                    <TableHead
                      colSpan={parametersHeaders.length}
                      className="border-l bg-muted text-center"
                    >
                      Parameters
                    </TableHead>
                  )}
                </TableRow>
              )}
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-20 whitespace-nowrap border-r bg-muted">
                  Run Name
                </TableHead>
                <TableHead className="whitespace-nowrap bg-muted">Created</TableHead>
                <TableHead className="whitespace-nowrap bg-muted text-right">Duration</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">User</TableHead>
                {metricsHeaders.map((header) => sortableHead(header, `metrics.${header}`))}
                {parametersHeaders.map((header) => sortableHead(header, `parameters.${header}`))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {runLoading ? (
                Array.from({ length: 8 }, (_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 4 }, (_, cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : runs?.runs.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columnCount} className="p-0">
                    <Empty className="py-16">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <BeakerIcon aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>No Runs Yet</EmptyTitle>
                        <EmptyDescription>
                          Runs logged to this experiment in MLflow appear here on their own.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                runs?.runs.map((run) => (
                  // The row is a large click target for the mouse; the button
                  // in its first cell is the same action for the keyboard.
                  <TableRow
                    key={run.info.run_id}
                    className="group cursor-pointer hover:bg-muted"
                    onClick={() => loadRunInfo(run.info.run_id)}
                  >
                    <TableCell className="sticky left-0 z-[1] whitespace-nowrap border-r bg-background group-hover:bg-muted">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          loadRunInfo(run.info.run_id);
                        }}
                        className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {run.info.run_name}
                      </button>
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap"
                      title={formatDateTime(run.info.start_time)}
                    >
                      {formatRelativeTime(run.info.start_time)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatDuration(run.info.start_time, run.info.end_time)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{run.info.user_name}</TableCell>
                    {metricsHeaders.map((header) => (
                      <TableCell
                        key={header}
                        className={cn("text-right tabular-nums", sortedCell(`metrics.${header}`))}
                      >
                        {displayValue(run.data.metrics[header])}
                      </TableCell>
                    ))}
                    {parametersHeaders.map((header) => (
                      <TableCell
                        key={header}
                        className={cn(
                          "whitespace-nowrap text-right tabular-nums",
                          sortedCell(`parameters.${header}`)
                        )}
                      >
                        {displayValue(run.data.parameters[header])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {runs?.nextPageToken && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMoreHandle} disabled={loadingMore}>
                {loadingMore && <Spinner />}
                {loadingMore ? "Loading…" : "Load More Runs"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="space-y-1 border-b px-6 py-4 pr-14 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="break-all">
                {runInfo?.info.run_name ?? "Loading run…"}
              </SheetTitle>
              {runInfo && (
                <Badge variant={isPublished(runInfo) ? "default" : "secondary"}>
                  {isPublished(runInfo) ? "Published" : "Not Published"}
                </Badge>
              )}
            </div>
            <SheetDescription>
              {runInfo
                ? `${runInfo.info.user_name} · ${formatDateTime(runInfo.info.start_time)} · ${formatDuration(
                    runInfo.info.start_time,
                    runInfo.info.end_time
                  )}`
                : "Fetching the run from MLflow."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-8 overflow-y-auto overscroll-contain px-6 py-6">
            {!runInfo ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-9 w-40" />
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-5" />
                ))}
              </div>
            ) : (
              <>
                <div>
                  {isPublished(runInfo) ? (
                    <Button variant="outline" onClick={() => setUnpublishOpen(true)}>
                      Unpublish Model…
                    </Button>
                  ) : (
                    <Button onClick={() => setPublishOpen(true)}>Publish Model…</Button>
                  )}
                </div>

                <section aria-labelledby="run-model-heading" className="flex flex-col gap-2">
                  <h3 id="run-model-heading" className="text-sm font-semibold">
                    Model
                  </h3>
                  <DetailList
                    entries={
                      model
                        ? [
                            ["Name", model.name],
                            ["Version", model.version],
                            ["Stage", isPublished(runInfo) ? "Production" : model.current_stage || "None"],
                          ]
                        : []
                    }
                  />
                </section>
                <Separator />
                <section aria-labelledby="run-metrics-heading" className="flex flex-col gap-2">
                  <h3 id="run-metrics-heading" className="text-sm font-semibold">
                    Metrics
                  </h3>
                  <DetailList
                    entries={Object.entries(runInfo.data.metrics ?? {}).map(([name, value]) => [
                      name,
                      displayValue(value),
                    ])}
                  />
                </section>
                <Separator />
                <section aria-labelledby="run-parameters-heading" className="flex flex-col gap-2">
                  <h3 id="run-parameters-heading" className="text-sm font-semibold">
                    Parameters
                  </h3>
                  <DetailList
                    entries={Object.entries(runInfo.data.parameters ?? {}).map(([name, value]) => [
                      name,
                      displayValue(value),
                    ])}
                  />
                </section>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        onPublish={publishModel}
      />
      <ConfirmDialog
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        destructive
        title="Unpublish This Model?"
        description="It will no longer be offered when uploading files. You can publish it again later."
        confirmLabel="Unpublish"
        pendingLabel="Unpublishing…"
        errorTitle="Couldn’t Unpublish Model"
        onConfirm={unPublishModel}
      />
    </div>
  );
}

Experiments.Layout = Layout;
Experiments.title = "Experiments";
export default Experiments;
