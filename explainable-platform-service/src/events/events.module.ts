import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { EventsController } from './events.controller';
import { EVENTS_REDIS_PUB, EVENTS_REDIS_SUB, EventsHub } from './events.hub';

/**
 * Two connections, because a Redis client in subscriber mode cannot issue
 * ordinary commands. Both point at the instance Bull already uses, so this costs
 * no new infrastructure.
 */
const redisProvider = (token: string, options: RedisOptions) => ({
  provide: token,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new Redis({
      host: config.get<string>('REDIS_HOST') ?? 'localhost',
      port: Number(config.get<string>('REDIS_PORT') ?? 6379),
      ...options,
    }),
});

/**
 * Global so any module (predictions, experiments, ...) can inject EventsHub
 * without each one needing to import EventsModule.
 */
@Global()
@Module({
  controllers: [EventsController],
  providers: [
    // Publishing fails at once while Redis is down, which is what lets EventsHub
    // fall back to this instance's own listeners. With the offline queue a
    // publish would wait out the whole outage, and nobody would hear it.
    redisProvider(EVENTS_REDIS_PUB, { enableOfflineQueue: false }),
    // The subscriber never gives up: an SSE stream that silently stops
    // delivering is worse than one that reconnects late, and ioredis
    // resubscribes its channels when it does.
    redisProvider(EVENTS_REDIS_SUB, { maxRetriesPerRequest: null }),
    EventsHub,
  ],
  exports: [EventsHub],
})
export class EventsModule {}
