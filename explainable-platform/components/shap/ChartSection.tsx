import { ReactNode } from "react";

/** One chart with a heading and a line on how to read it. */
export function ChartSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground [text-wrap:pretty]">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}
