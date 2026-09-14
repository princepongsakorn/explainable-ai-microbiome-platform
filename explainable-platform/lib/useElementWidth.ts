import { useCallback, useEffect, useState } from "react";

/**
 * The content width of an element, kept current as it resizes.
 *
 * Returns a callback ref to put on the element and its width in pixels, or
 * undefined until the element has mounted. A callback ref, not a ref object,
 * because the element can appear after the first render.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState<number>();

  const ref = useCallback((node: T | null) => setElement(node), []);

  useEffect(() => {
    if (!element) return;
    const update = () => setWidth(Math.floor(element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, width] as const;
}
