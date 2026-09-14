import { toast } from "sonner";

/**
 * Short-lived feedback that does not stop the page. Blocking modals are kept
 * for questions the user has to answer, not for news.
 */
export const notifySuccess = (title: string, description?: string) =>
  toast.success(title, { description });

export const notifyError = (title: string, description?: string) =>
  toast.error(title, { description });
