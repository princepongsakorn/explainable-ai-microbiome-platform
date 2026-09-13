declare module "@heroicons/react/outline";
declare module "@heroicons/react/solid";

// react-dom ships no types of its own and @types/react-dom is not installed —
// @types/react is pinned at 17 here while react runs 18, so pulling in a
// matching @types/react-dom risks disagreeing with that pin. Declaring the one
// function we use keeps it typed without touching either.
declare module "react-dom" {
  import { ReactNode, ReactPortal } from "react";
  export function createPortal(
    children: ReactNode,
    container: Element,
    key?: string | null
  ): ReactPortal;
}
