import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EventsController } from './events.controller';
import { EVENTS_REDIS_PUB, EVENTS_REDIS_SUB, EventsHub } from './events.hub';

/**
 * Two connections, because a Redis client in subscriber mode cannot issue
 * ordinary commands. Both point at the instance Bull already uses, so this costs
 * no new infrastructure.
 */
const redisProvider = (token: string) => ({
  provide: token,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new Redis({
      host: config.get<string>('REDIS_HOST') ?? 'localhost',
      port: Number(config.get<string>('REDIS_PORT') ?? 6379),
      // Never give up: an SSE stream that silently stops delivering is worse
      // than one that reconnects late.
      maxRetriesPerRequest: null,
      lazyConnect: false,
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
    redisProvider(EVENTS_REDIS_PUB),
    redisProvider(EVENTS_REDIS_SUB),
    EventsHub,
  ],
  exports: [EventsHub],
})
export class EventsModule {}
