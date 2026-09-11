import { Injectable, MessageEvent, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, finalize } from 'rxjs';

/**
 * In-process event bus that fans out per-resource updates to any open SSE
 * connection. Keyed by a string topic so we can scope streams to a single
 * prediction or experiment without leaking unrelated activity.
 *
 * The current deployment runs a single backend container, so an in-memory
 * Subject is sufficient. If the service is ever scaled horizontally, swap
 * the internals for a Redis pub/sub adapter — the public API can stay.
 */
@Injectable()
export class EventsHub implements OnModuleDestroy {
  private readonly streams = new Map<string, Subject<MessageEvent>>();

  /**
   * Push an event to every subscriber on the given topic. Safe to call
   * even when no one is listening — we simply skip emitting.
   */
  publish<T = unknown>(topic: string, type: string, data: T): void {
    const stream = this.streams.get(topic);
    if (!stream) return;
    stream.next({
      type,
      data,
    } as MessageEvent);
  }

  /**
   * Open (or reuse) a stream for the given topic. The Observable cleans
   * itself up when the last subscriber disconnects so we don't keep dead
   * Subjects around in the map.
   */
  subscribe(topic: string): Observable<MessageEvent> {
    let stream = this.streams.get(topic);
    if (!stream) {
      stream = new Subject<MessageEvent>();
      this.streams.set(topic, stream);
    }
    const current = stream;
    return current.asObservable().pipe(
      finalize(() => {
        if (current.observed === false) {
          current.complete();
          this.streams.delete(topic);
        }
      }),
    );
  }

  // Convenience helpers so call sites don't have to assemble topic strings.
  publishPrediction<T>(predictionId: string, type: string, data: T): void {
    this.publish(`prediction:${predictionId}`, type, data);
  }

  subscribePrediction(predictionId: string): Observable<MessageEvent> {
    return this.subscribe(`prediction:${predictionId}`);
  }

  publishExperiment<T>(experimentId: string, type: string, data: T): void {
    this.publish(`experiment:${experimentId}`, type, data);
  }

  subscribeExperiment(experimentId: string): Observable<MessageEvent> {
    return this.subscribe(`experiment:${experimentId}`);
  }

  onModuleDestroy(): void {
    for (const stream of this.streams.values()) {
      stream.complete();
    }
    this.streams.clear();
  }
}
