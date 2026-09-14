import { ReactNode } from "react";

/**
 * The first cell of a table row that opens something when clicked.
 *
 * The whole row is a large click target for the mouse; this button is the
 * same action for the keyboard, and stops its click reaching the row so the
 * action runs once.
 */
export function RowOpenButton({
  onOpen,
  children,
}: {
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
