import { useEffect, useState } from "react";
import { CheckIcon, ClipboardIcon } from "@heroicons/react/24/outline";
import { useCopyToClipboard } from "usehooks-ts";

import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/notify";
import { cn } from "@/lib/utils";

/** How long the button shows its "copied" state. */
const COPIED_MS = 2000;

/** Copies a value, confirms it briefly, and tells screen readers it did. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  /** What the button copies, e.g. "Copy code". */
  label: string;
  className?: string;
}) {
  const [, copyToClipboard] = useCopyToClipboard();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    if (await copyToClipboard(value)) {
      setCopied(true);
    } else {
      notifyError("Couldn’t Copy", "Select the text and copy it by hand.");
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn("size-9 shrink-0", className)}
        aria-label={copied ? "Copied" : label}
        disabled={!value}
        onClick={copy}
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <ClipboardIcon aria-hidden="true" />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Copied to the clipboard." : ""}
      </span>
    </>
  );
}
