import Layout from "@/components/common/Layout";
import { ArrowRightIcon, ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { isAxiosError } from "axios";

import { getModelsList } from "../api/model";
import { postModelPredict } from "../api/predict";
import {
  ICreatePredictions,
  IMetrics,
  IProductionModelInfo,
} from "@/components/model/model.interface";
import { queryToString } from "@/lib/queryToString";
import { displayValue, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

/** The filter value for models whose type was never recorded. */
const UNTYPED = "__untyped__";

const typeOf = (model: IProductionModelInfo) => model.description.model || UNTYPED;

function describeMetrics(metrics: IMetrics): string {
  const parts: string[] = [];
  if (metrics.accuracy) parts.push(`Accuracy ${formatPercent(metrics.accuracy)}`);
  if (metrics.roc_auc) parts.push(`AUC ${displayValue(Number(metrics.roc_auc))}`);
  return parts.join(" · ");
}

const ModelPickerDialog = (props: {
  models: IProductionModelInfo[];
  selectedModel?: IProductionModelInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (model: IProductionModelInfo) => void;
}) => {
  const types = useMemo(
    () => Array.from(new Set(props.models.map(typeOf))),
    [props.models]
  );
  const [type, setType] = useState<string>();
  const [pending, setPending] = useState<IProductionModelInfo>();

  // Every time the dialog opens, start from what is chosen on the page.
  useEffect(() => {
    if (!props.open) return;
    setPending(props.selectedModel);
    setType(props.selectedModel ? typeOf(props.selectedModel) : types[0]);
  }, [props.open]);

  const shown = props.models.filter((model) => typeOf(model) === type);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose a Model</DialogTitle>
          <DialogDescription>
            Models published to production, grouped by what they predict.
          </DialogDescription>
        </DialogHeader>

        {types.length > 1 && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={type}
            onValueChange={(value) => value && setType(value)}
            aria-label="Model type"
            className="flex-wrap justify-start"
          >
            {types.map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {value === UNTYPED ? "Other" : value}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}

        <div
          role="radiogroup"
          aria-label="Models"
          className="-mx-1 flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-1 py-1"
        >
          {shown.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No Models Published</EmptyTitle>
                <EmptyDescription>
                  Publish a run from Experiments to make it available here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            shown.map((model) => (
              <label
                key={model.run_id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="radio"
                  name="model"
                  value={model.run_id}
                  checked={pending?.run_id === model.run_id}
                  onChange={() => setPending(model)}
                  className="mt-1 accent-primary focus:outline-none"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium">
                    {model.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      v{model.version}
                    </span>
                  </span>
                  <span className="break-words text-sm text-muted-foreground">
                    {model.description.description || "No description."}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {describeMetrics(model.metrics)}
                </span>
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!pending}
            onClick={() => pending && props.onChoose(pending)}
          >
            Use This Model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type FormErrors = { file?: string; model?: string; upload?: string };

function uploadErrorMessage(error: unknown): string {
  const serverMessage = isAxiosError(error) ? error.response?.data?.message : undefined;
  const detail = typeof serverMessage === "string" ? ` The server said: ${serverMessage}` : "";
  return `The upload didn’t go through. Check that the file is a valid CSV, then try again.${detail}`;
}

export function Home() {
  const router = useRouter();
  // Changing the key clears the native file input, which cannot be reset by value.
  const [formKey, setFormKey] = useState(0);
  const [models, setModels] = useState<IProductionModelInfo[]>();
  const [model, setModel] = useState<IProductionModelInfo>();
  const [progress, setProgress] = useState(0);
  const [csv, setCsv] = useState<File>();
  const [created, setCreated] = useState<ICreatePredictions>();
  const [errors, setErrors] = useState<FormErrors>({});
  const [isUploading, setIsUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    getModelsList()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    setCsv(event.target.files?.[0]);
    setErrors((prev) => ({ ...prev, file: undefined, upload: undefined }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: FormErrors = {};
    if (!csv) next.file = "Choose a CSV file to upload.";
    else if (!csv.name.toLowerCase().endsWith(".csv"))
      next.file = `“${csv.name}” isn’t a CSV. Choose a .csv file.`;
    if (!model) next.model = "Choose the model to predict with.";
    setErrors(next);
    if (next.file || next.model || !csv || !model) return;

    setIsUploading(true);
    setProgress(0);
    try {
      const result = await postModelPredict(csv, model.name, (event) => {
        if (event.total) setProgress(Math.round((event.loaded * 100) / event.total));
      });
      setCreated(result);
    } catch (error) {
      setErrors({ upload: uploadErrorMessage(error) });
    } finally {
      setIsUploading(false);
    }
  };

  const startOver = () => {
    setCreated(undefined);
    setCsv(undefined);
    setModel(undefined);
    setErrors({});
    setFormKey((key) => key + 1);
  };

  const viewPrediction = () => {
    if (created?.predictionId) {
      router.push(`/prediction/local?${queryToString({ id: created.predictionId })}`);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Upload File"
        description="Upload a CSV of samples and choose a model to predict them with."
      />

      <form
        key={formKey}
        noValidate
        onSubmit={handleSubmit}
        className="max-w-2xl rounded-lg border bg-card p-6 shadow-sm"
      >
        <FieldGroup className="gap-6">
          <Field data-invalid={errors.file ? true : undefined}>
            <FieldLabel htmlFor="csv-file">Sample file</FieldLabel>
            <Input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileSelect}
              disabled={isUploading}
              aria-invalid={errors.file ? true : undefined}
              className="cursor-pointer file:mr-3 file:cursor-pointer"
            />
            <FieldDescription>
              A .csv file with one row per sample and one column per taxon.
            </FieldDescription>
            {errors.file && <FieldError>{errors.file}</FieldError>}
          </Field>

          <Field data-invalid={errors.model ? true : undefined}>
            <FieldLabel htmlFor="model-picker">Model</FieldLabel>
            <Button
              id="model-picker"
              type="button"
              variant="outline"
              aria-invalid={errors.model ? true : undefined}
              aria-haspopup="dialog"
              disabled={isUploading || !models}
              onClick={() => setPickerOpen(true)}
              className={cn(
                "justify-between font-normal",
                !model && "text-muted-foreground"
              )}
            >
              <span className="truncate">
                {model
                  ? `${model.name} v${model.version}`
                  : models
                  ? "Choose a model…"
                  : "Loading models…"}
              </span>
              <ChevronUpDownIcon aria-hidden="true" />
            </Button>
            {errors.model && <FieldError>{errors.model}</FieldError>}
          </Field>

          {errors.upload && <FieldError>{errors.upload}</FieldError>}

          <div className="flex flex-col gap-3">
            <Button type="submit" disabled={isUploading} className="self-end">
              {isUploading ? (
                <>
                  <Spinner />
                  Uploading…
                </>
              ) : (
                <>
                  Upload and Predict
                  <ArrowRightIcon aria-hidden="true" />
                </>
              )}
            </Button>
            {isUploading && (
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                className="h-1 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full w-full origin-left bg-primary transition-transform duration-300 motion-reduce:transition-none"
                  style={{ transform: `scaleX(${progress / 100})` }}
                />
              </div>
            )}
          </div>
        </FieldGroup>
      </form>

      <ModelPickerDialog
        models={models ?? []}
        selectedModel={model}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onChoose={(chosen) => {
          setModel(chosen);
          setErrors((prev) => ({ ...prev, model: undefined }));
          setPickerOpen(false);
        }}
      />

      <Dialog open={!!created} onOpenChange={(open) => !open && startOver()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prediction Created</DialogTitle>
            <DialogDescription>
              The file uploaded and its samples are queued. Open the prediction
              to follow each sample’s progress, or upload another file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={startOver}>
              Upload Another File
            </Button>
            <Button onClick={viewPrediction}>View Prediction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

Home.Layout = Layout;
Home.title = "Upload File";
export default Home;
