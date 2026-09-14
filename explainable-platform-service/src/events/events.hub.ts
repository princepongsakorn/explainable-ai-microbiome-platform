import {
  Inject,
  Injectable,
  Logger,
  MessageEvent,
  OnModuleDestroy,
} from '@nestjs/common';
import { Observable, Subject, finalize } from 'rxjs';

export const EVENTS_REDIS_PUB = 'EVENTS_REDIS_PUB';
export const EVENTS_REDIS_SUB = 'EVENTS_REDIS_SUB';

/**
 * The slice of ioredis this hub uses. Narrow on purpose so the behaviour can be
 * tested without a Redis server.
 */
export interface EventsRedis {
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
  quit(): Promise<unknown>;
  disconnect(): void;
}

const CHANNEL_PREFIX = 'events:';

/**
 * Event bus that fans out per-resource updates to any open SSE connection,
 * across every instance of this service.
 *
 * Each topic maps to a Redis channel. Publishing writes to Redis; the subscriber
 * connection pushes what comes back into a local Subject, which is what the SSE
 * handlers are attached to. Delivery therefore takes the same path whether the
 * event originated on this instance or another one — there is no special case,
 * and no chance of delivering an event twice.
 *
 * A separate subscriber connection is required: a Redis client in subscriber mode
 * cannot issue ordinary commands.
 */
@Injectable()
export class EventsHub implements OnModuleDestroy {
  private readonly logger = new Logger(EventsHub.name);
  private readonly streams = new Map<string, Subject<MessageEvent>>();
  /** Work in flight, so tests and shutdown can wait for it. */
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(EVENTS_REDIS_PUB) private readonly publisher: EventsRedis,
    @Inject(EVENTS_REDIS_SUB) private readonly subscriber: EventsRedis,
  ) {
    this.subscriber.on('message', (channel, message) => {
      const topic = channel.slice(CHANNEL_PREFIX.length);
      const stream = this.streams.get(topic);
      if (!stream) return;
      try {
        const { type, data } = JSON.parse(message);
        stream.next({ type, data } as MessageEvent);
      } catch (error) {
        this.logger.warn(
          `dropped an unparseable event on ${channel}: ${(error as Error).message}`,
        );
      }
    });
  }

  /**
   * Push an event to every subscriber on the topic, on any instance.
   *
   * Published unconditionally — another instance may have listeners even when
   * this one does not.
   */
  publish<T = unknown>(topic: string, type: string, data: T): void {
    const channel = CHANNEL_PREFIX + topic;
    const message = JSON.stringify({ type, data });

    this.track(
      this.publisher.publish(channel, message).catch((error) => {
        // Redis is unreachable. Deliver to this instance's own listeners so a
        // single-instance deployment keeps working instead of going silent.
        this.logger.warn(
          `publish to ${channel} failed (${(error as Error).message}); ` +
            'delivering locally only',
        );
        this.streams.get(topic)?.next({ type, data } as MessageEvent);
      }),
    );
  }

  /**
   * Open (or reuse) a stream for the topic. The Redis channel is subscribed while
   * at least one local listener wants it and unsubscribed when the last one goes,
   * so an instance only carries traffic it is actually serving.
   */
  subscribe(topic: string): Observable<MessageEvent> {
    const channel = CHANNEL_PREFIX + topic;
    let stream = this.streams.get(topic);

    if (!stream) {
      stream = new Subject<MessageEvent>();
      this.streams.set(topic, stream);
      this.track(
        this.subscriber.subscribe(channel).catch((error) =>
          this.logger.warn(
            `subscribe to ${channel} failed: ${(error as Error).message}`,
          ),
        ),
      );
    }

    const current = stream;
    return current.asObservable().pipe(
      finalize(() => {
        if (current.observed === false) {
          current.complete();
          this.streams.delete(topic);
          this.track(
            this.subscriber.unsubscribe(channel).catch((error) =>
              this.logger.warn(
                `unsubscribe from ${channel} failed: ${(error as Error).message}`,
              ),
            ),
          );
        }
      }),
    );
  }

  /** Settle the Redis calls issued so far. */
  async flush(): Promise<void> {
    await this.pending;
  }

  private track(work: Promise<unknown>): void {
    this.pending = this.pending.then(() => work);
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

  async onModuleDestroy(): Promise<void> {
    for (const stream of this.streams.values()) {
      stream.complete();
    }
    this.streams.clear();
    // disconnect(), not quit(), for the subscriber: quit is itself a command, and
    // with Redis down it would sit in the offline queue — as would any subscribe
    // still pending — so shutdown would hang until Redis came back.
    this.subscriber.disconnect();
    await this.flush();
    await this.publisher.quit().catch(() => undefined);
  }
}
