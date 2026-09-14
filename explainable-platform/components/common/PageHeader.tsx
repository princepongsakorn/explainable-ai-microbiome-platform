import { ReactNode } from "react";

/** A page's title, what it is for, and the actions that apply to all of it. */
export function PageHeader({
  title,
  description,
  actions,
  leading,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Sits before the title, e.g. a back button. */
  leading?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
      <div className="flex min-w-0 items-start gap-2">
        {leading}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight [text-wrap:balance]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground [text-wrap:pretty]">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
