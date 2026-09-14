import { useId } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface PaginationProps {
  className?: string;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  itemCount: number;
  onChange: (currentPage: number) => void;
}

export const Pagination = ({
  currentPage,
  totalPages,
  totalItems,
  itemCount,
  itemsPerPage,
  className,
  onChange,
}: PaginationProps) => {
  const pageLabelId = useId();

  // Nothing to page through, or the first response has not arrived yet.
  if (totalPages < 1 || totalItems < 1) return null;

  const first = (currentPage - 1) * itemsPerPage + 1;
  const last = first + itemCount - 1;
  const range = itemCount <= 1 ? `${first}` : `${first}–${last}`;
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex w-full flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground",
        className
      )}
    >
      <p className="tabular-nums">
        {range} of {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <span id={pageLabelId}>Page</span>
        <Select value={String(currentPage)} onValueChange={(value) => onChange(Number(value))}>
          <SelectTrigger aria-labelledby={pageLabelId} className="h-8 w-[4.5rem] tabular-nums">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectGroup>
              {pages.map((page) => (
                <SelectItem key={page} value={String(page)} className="tabular-nums">
                  {page}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="tabular-nums">of {totalPages}</span>
        <Button
          variant="outline"
          size="icon"
          className="ml-2 size-8"
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={() => onChange(currentPage - 1)}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Next page"
          disabled={currentPage >= totalPages}
          onClick={() => onChange(currentPage + 1)}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
};
