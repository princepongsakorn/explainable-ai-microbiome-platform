import { useState } from "react";
import { isAxiosError } from "axios";

import { RunDetailsSheet } from "@/components/experiments/RunDetailsSheet";
import { getModelVersionRun } from "@/pages/api/experiments";
import { notifyError } from "@/lib/notify";

/**
 * The model behind a prediction, opening that exact model version's details.
 *
 * Only the recorded version is ever opened: a model's name alone says nothing
 * about which version made a prediction, and the one in Production now may
 * not be it. A prediction without a recorded version shows the name as text.
 */
export function ModelLink({ name, version }: { name: string; version?: string | null }) {
  const [open, setOpen] = useState(false);
  const [runId, setRunId] = useState<string>();
  const [missing, setMissing] = useState(false);

  if (!version) {
    return (
      <span className="font-medium text-foreground" title="This prediction didn’t record its model version">
        {name}
      </span>
    );
  }

  const openDetails = async () => {
    setRunId(undefined);
    setMissing(false);
    // Open at once so the click is answered; the sheet shows its loading state.
    setOpen(true);
    try {
      const found = await getModelVersionRun(name, version);
      setRunId(found.run_id);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        setMissing(true);
        return;
      }
      setOpen(false);
      notifyError("Couldn’t Open Model", "MLflow didn’t answer. Try again in a moment.");
    }
  };

  return (
    <>
      <button
        type="button"
        title="Open model details"
        onClick={openDetails}
        className="cursor-pointer rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {name} v{version}
      </button>
      <RunDetailsSheet
        runId={runId}
        open={open}
        onOpenChange={setOpen}
        unavailable={
          missing
            ? {
                title: `${name} v${version}`,
                description:
                  "This model version is no longer in the registry. It may have been deleted, so its details can’t be shown.",
              }
            : undefined
        }
      />
    </>
  );
}
