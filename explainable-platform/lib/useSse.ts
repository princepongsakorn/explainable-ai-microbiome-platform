import { useEffect, useRef } from "react";
import {
  fetchEventSource,
  EventStreamContentType,
  EventSourceMessage,
} from "@microsoft/fetch-event-source";
import { getToken } from "../pages/api/httpClient";

const API_BASE_URL = process.env.NEXT_PUBLIC_API ?? "/api";

type SseHandlers = {
  /**
   * Fires for every event the server emits, regardless of type.
   * Use this for blanket handling; pair with the `type` field on the event
   * to branch by event name.
   */
  onMessage?: (event: EventSourceMessage) => void;
  /**
   * Fires once when the stream is established (headers received, 200 OK,
   * content-type text/event-stream). Useful for clearing loading flags.
   */
  onOpen?: () => void;
  /**
   * Fires when the underlying fetch errors. Return a number to override
   * the automatic retry delay (ms), or throw to give up. Default is
   * exponential backoff capped at 30s.
   */
  onError?: (err: unknown) => number | void;
};

class FatalSseError extends Error {}

/**
 * Subscribe to a server-sent-event stream while the component is mounted.
 *
 * Why not native EventSource? It doesn't support custom request headers,
 * so we can't attach the Bearer token expected by JwtAuthGuard. The
 * Microsoft polyfill is fetch-based, supports headers, and gives us a
 * clean AbortController to tear the connection down on unmount.
 *
 * @param path Path under NEXT_PUBLIC_API (e.g. `/events/predictions/abc`).
 *             Pass `null` to disable subscription (useful while waiting
 *             for a route param to hydrate).
 */
export function useSse(path: string | null, handlers: SseHandlers) {
  // Keep the handler refs current without re-establishing the connection
  // on every render. Only `path` should trigger reconnection.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!path) return;

    const controller = new AbortController();

    const run = async () => {
      try {
        await fetchEventSource(`${API_BASE_URL}${path}`, {
          signal: controller.signal,
          // Without this, the browser keeps the connection open even after
          // the tab is hidden — fine in dev, but it wastes a backend slot.
          openWhenHidden: false,
          headers: (() => {
            // Build explicitly typed as Record<string, string>: a ternary
            // returning `{}` widens to `{ Authorization?: undefined }`, which
            // is not assignable to the headers index signature.
            const headers: Record<string, string> = {};
            const token = getToken();
            if (token) headers.Authorization = `Bearer ${token}`;
            return headers;
          })(),
          async onopen(res) {
            if (
              res.ok &&
              res.headers.get("content-type")?.includes(EventStreamContentType)
            ) {
              handlersRef.current.onOpen?.();
              return;
            }
            // 401/403 etc. — don't retry, the token is bad.
            throw new FatalSseError(
              `SSE refused: ${res.status} ${res.statusText}`,
            );
          },
          onmessage(ev) {
            handlersRef.current.onMessage?.(ev);
          },
          onerror(err) {
            // Bubble auth failures up to the caller; everything else falls
            // through to fetch-event-source's built-in exponential backoff.
            if (err instanceof FatalSseError) throw err;
            return handlersRef.current.onError?.(err);
          },
        });
      } catch (err) {
        // Swallow the abort thrown by controller.abort() on unmount.
        if (!controller.signal.aborted) {
          // eslint-disable-next-line no-console
          console.error("[useSse] stream terminated:", err);
        }
      }
    };

    run();
    return () => controller.abort();
  }, [path]);
}
