import { Global, Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsHub } from './events.hub';

/**
 * Global so any module (predictions, experiments, ...) can inject EventsHub
 * without each one needing to import EventsModule.
 */
@Global()
@Module({
  controllers: [EventsController],
  providers: [EventsHub],
  exports: [EventsHub],
})
export class EventsModule {}
