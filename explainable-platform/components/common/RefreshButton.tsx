import { useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { notifyError } from "@/lib/notify";

/** Reloads a page's data, showing it is working and saying if it failed. */
export function RefreshButton({
  onRefresh,
  disabled = false,
  errorTitle = "Couldn’t Refresh",
}: {
  onRefresh: () => Promise<unknown>;
  disabled?: boolean;
  errorTitle?: string;
}) {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      notifyError(errorTitle, "Try again in a moment.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={refresh} disabled={disabled || refreshing}>
      {refreshing ? <Spinner /> : <ArrowPathIcon aria-hidden="true" />}
      Refresh
    </Button>
  );
}
