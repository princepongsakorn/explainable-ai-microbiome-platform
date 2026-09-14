import { MouseEvent, ReactNode, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { notifyError } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * A question the user must answer before something happens. The dialog stays
 * open while the action runs and closes only when it succeeds; a failure is
 * reported and leaves the dialog up so the user can try again.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = false,
  errorTitle,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Shown on the confirm button while the action runs, e.g. "Canceling…". */
  pendingLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** The toast title if the action fails, e.g. "Couldn’t Cancel Jobs". */
  errorTitle: string;
  onConfirm: () => unknown | Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);

  const confirm = async (event: MouseEvent) => {
    // AlertDialogAction closes the dialog on click; hold it open until done.
    event.preventDefault();
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      notifyError(errorTitle, "Nothing was changed. Try again in a moment.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={confirm}
            className={cn(destructive && buttonVariants({ variant: "destructive" }))}
          >
            {pending && <Spinner />}
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
