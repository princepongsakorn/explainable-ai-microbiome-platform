import { FormEvent, useEffect, useRef, useState } from "react";
import { CubeTransparentIcon } from "@heroicons/react/24/outline";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { IRunDetail } from "@/components/model/experiments.interface";
import { IModelType } from "@/components/model/model.interface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { displayValue, formatDateTime, formatDuration } from "@/lib/format";
import { notifyError, notifySuccess } from "@/lib/notify";
import {
  getRunById,
  putPublicModelByRunId,
  putUnPublicModelByRunId,
} from "@/pages/api/experiments";
import { getModelsType } from "@/pages/api/model";

const isPublished = (run?: IRunDetail) => run?.models?.[0]?.current_stage === "Production";

/**
 * Publish stores the model type and description as JSON in the model version's
 * description. Anything else, such as a description set in MLflow directly, is
 * shown as it is.
 */
function parsePublishDescription(raw?: string): { typeId?: string; text?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { typeId: parsed.model ?? undefined, text: parsed.description ?? undefined };
    }
  } catch {
    // Not JSON: fall through to plain text.
  }
  return { text: raw };
}

const PublishDialog = (props: {
  open: boolean;
  modelTypes?: IModelType[];
  onOpenChange: (open: boolean) => void;
  onPublish: (data: { model: IModelType; description: string }) => Promise<void>;
}) => {
  const { modelTypes } = props;
  const [typeId, setTypeId] = useState<string>();
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ type?: string; description?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setTypeId(undefined);
    setDescription("");
    setErrors({});
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

/** A two-column list of names and values. */
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

/**
 * One run in MLflow, with its registered model and the Publish / Unpublish
 * actions. Shared by Experiments and Registered Models so both show the same
 * thing. It loads the run itself; `onChanged` tells the page to refresh after
 * a publish or unpublish.
 */
export function RunDetailsSheet({
  runId,
  open,
  onOpenChange,
  onChanged,
  unavailable,
}: {
  runId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  /** Set when there is nothing to load, e.g. a model version since deleted. */
  unavailable?: { title: string; description: string };
}) {
  const [run, setRun] = useState<IRunDetail>();
  const [modelTypes, setModelTypes] = useState<IModelType[]>();
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  // The run last asked for, so a slow answer for an earlier one cannot land.
  const requestedRef = useRef<string>();

  useEffect(() => {
    getModelsType()
      .then(setModelTypes)
      .catch(() => setModelTypes([]));
  }, []);

  const loadRun = async (id: string) => {
    requestedRef.current = id;
    const response = await getRunById(id);
    if (requestedRef.current === id && response.run) setRun(response.run);
  };

  // Opens straight away and fills in when the run arrives, so the click is
  // answered even on a slow MLflow.
  useEffect(() => {
    if (!open || !runId) return;
    setRun(undefined);
    loadRun(runId).catch(() => {
      if (requestedRef.current !== runId) return;
      onOpenChange(false);
      notifyError("Couldn’t Open Run", "MLflow didn’t answer. Try again in a moment.");
    });
  }, [open, runId]);

  const publish = async (data: { model: IModelType; description: string }) => {
    if (!runId) return;
    await putPublicModelByRunId(runId, data);
    await loadRun(runId);
    onChanged?.();
    notifySuccess("Model Published", "It is now offered when uploading files.");
  };

  const unpublish = async () => {
    if (!runId) return;
    await putUnPublicModelByRunId(runId);
    await loadRun(runId);
    onChanged?.();
    notifySuccess("Model Unpublished");
  };

  const model = run?.models?.[0];
  const published = parsePublishDescription(model?.description);
  const modelType = modelTypes?.find((type) => type.id === published.typeId);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="space-y-1 border-b px-6 py-4 pr-14 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="break-all">
                {unavailable?.title ?? run?.info.run_name ?? "Loading run…"}
              </SheetTitle>
              {run && !unavailable && (
                <Badge variant={isPublished(run) ? "default" : "secondary"}>
                  {isPublished(run) ? "Published" : "Not Published"}
                </Badge>
              )}
            </div>
            <SheetDescription>
              {unavailable
                ? "Model version unavailable."
                : run
                ? `${run.info.user_name} · ${formatDateTime(run.info.start_time)} · ${formatDuration(
                    run.info.start_time,
                    run.info.end_time
                  )}`
                : "Fetching the run from MLflow."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-8 overflow-y-auto overscroll-contain px-6 py-6">
            {unavailable ? (
              <Empty className="flex-1">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CubeTransparentIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>Model Not Found</EmptyTitle>
                  <EmptyDescription>{unavailable.description}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : !run ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-9 w-40" />
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-5" />
                ))}
              </div>
            ) : (
              <>
                <div>
                  {isPublished(run) ? (
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
                            ["Stage", isPublished(run) ? "Production" : model.current_stage || "None"],
                            [
                              "Type",
                              modelType
                                ? `${modelType.name} (${modelType.description})`
                                : published.typeId ?? "—",
                            ],
                            ["Description", published.text || "—"],
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
                    entries={Object.entries(run.data.metrics ?? {}).map(([name, value]) => [
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
                    entries={Object.entries(run.data.parameters ?? {}).map(([name, value]) => [
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
        modelTypes={modelTypes}
        onOpenChange={setPublishOpen}
        onPublish={publish}
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
        onConfirm={unpublish}
      />
    </>
  );
}
