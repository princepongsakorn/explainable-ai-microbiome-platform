import { useEffect, useState } from "react";
import { ArrowPathIcon, KeyIcon } from "@heroicons/react/24/outline";

import Layout from "@/components/common/Layout";
import { PageHeader } from "@/components/common/PageHeader";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CopyButton } from "@/components/common/CopyButton";
import { EXCodeBlock } from "@/components/ui/CodeBlock/CodeBlock";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { notifyError, notifySuccess } from "@/lib/notify";
import { generateMLFlowToken, getMLFlowToken, getMLFlowTrackingUri } from "../api/mlflow";

function CredentialField({
  id,
  label,
  value,
  loading,
  copyable = true,
  description,
}: {
  id: string;
  label: string;
  value?: string;
  loading: boolean;
  copyable?: boolean;
  description?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {loading ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <div className="flex gap-2">
          <Input
            id={id}
            readOnly
            value={value ?? ""}
            placeholder="—"
            spellCheck={false}
            translate="no"
            className="font-mono text-sm"
          />
          {copyable && (
            <CopyButton value={value ?? ""} label={`Copy ${label.toLowerCase()}`} />
          )}
        </div>
      )}
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

export function AccessTokensPage() {
  const [token, setToken] = useState<{ user: string; token?: string }>();
  const [mlflowUrl, setMlflowUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  // The server keeps only a masked copy, so the full token exists on this
  // page only between generating it and leaving.
  const [freshToken, setFreshToken] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    Promise.all([
      getMLFlowToken().then(setToken),
      getMLFlowTrackingUri().then((uri) => setMlflowUrl(uri.url)),
    ])
      .catch(() =>
        notifyError("Couldn’t Load Your Credentials", "Refresh the page to try again.")
      )
      .finally(() => setLoading(false));
  }, []);

  const generate = async () => {
    const result = await generateMLFlowToken();
    setToken(result);
    setFreshToken(result.token);
    notifySuccess("New Token Generated", "Copy it now: it won’t be shown in full again.");
  };

  // The first token replaces nothing, so it needs no confirmation.
  const generateFirst = async () => {
    setGenerating(true);
    try {
      await generate();
    } catch {
      notifyError("Couldn’t Generate Token", "Try again in a moment.");
    } finally {
      setGenerating(false);
    }
  };

  const hasToken = Boolean(token?.token);

  const mlflowCode = `import os
import mlflow

# Set up MLflow authentication (place this at the top of your script)
os.environ['MLFLOW_TRACKING_USERNAME'] = "${token?.user ?? "your-username"}"
os.environ['MLFLOW_TRACKING_PASSWORD'] = "your-access-token"
mlflow.set_tracking_uri("${mlflowUrl ?? "https://your-mlflow-host"}")

# Your MLflow operations go here...`;

  return (
    <div className="flex flex-col gap-8 p-8">
      <PageHeader
        title="Personal Access Tokens"
        description="Credentials for logging and deploying models to MLflow from your own scripts."
      />

      <section aria-labelledby="credentials-heading" className="flex max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 id="credentials-heading" className="text-lg font-semibold">
              Your Credentials
            </h2>
            <p className="mt-1 text-sm text-muted-foreground [text-wrap:pretty]">
              Keep your token out of public repositories. If it leaks, generate a new one:
              the old token stops working as soon as the new one is made.
            </p>
          </div>
          <Button
            variant={hasToken ? "outline" : "default"}
            disabled={loading || generating}
            onClick={hasToken ? () => setConfirmOpen(true) : generateFirst}
          >
            {generating ? <Spinner /> : <ArrowPathIcon aria-hidden="true" />}
            {hasToken ? "Generate New Token…" : "Generate Token"}
          </Button>
        </div>

        {freshToken && (
          <Alert>
            <KeyIcon aria-hidden="true" className="size-4" />
            <AlertTitle>Copy Your New Token Now</AlertTitle>
            <AlertDescription>
              It is shown in full only this once. Leaving or reloading this page hides it.
            </AlertDescription>
          </Alert>
        )}

        <FieldGroup className="gap-5">
          <CredentialField
            id="mlflow-username"
            label="Username"
            value={token?.user}
            loading={loading}
          />
          <CredentialField
            id="mlflow-token"
            label="Access token"
            value={freshToken ?? token?.token}
            loading={loading}
            copyable={Boolean(freshToken)}
            description={
              freshToken
                ? undefined
                : hasToken
                ? "Only the first and last four characters are shown. Generate a new token if you no longer have it."
                : "You haven’t generated a token yet."
            }
          />
          <CredentialField
            id="mlflow-uri"
            label="MLflow tracking URI"
            value={mlflowUrl}
            loading={loading}
          />
        </FieldGroup>
      </section>

      <Separator />

      <section aria-labelledby="usage-heading" className="flex flex-col gap-4">
        <h2 id="usage-heading" className="text-lg font-semibold">
          Using Your Token in a Python Script
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground [text-wrap:pretty]">
          To authenticate MLflow and enable model deployment, set your username, access token and
          tracking URI at the top of your Python script before any MLflow call.
        </p>
        <EXCodeBlock code={mlflowCode} language={"python"} />
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title="Generate a New Token?"
        description="Your current token stops working as soon as the new one is made. Update any scripts that use it."
        confirmLabel="Generate New Token"
        pendingLabel="Generating…"
        errorTitle="Couldn’t Generate Token"
        onConfirm={generate}
      />
    </div>
  );
}

AccessTokensPage.Layout = Layout;
AccessTokensPage.title = "Personal Access Tokens";
export default AccessTokensPage;
