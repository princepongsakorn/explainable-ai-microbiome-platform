import {
  Controller,
  MessageEvent,
  Param,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { EventsHub } from './events.hub';

// Heartbeat keeps the connection from being closed by idle-timeout proxies
// (nginx defaults to 60s) and lets the client detect a dead socket.
const HEARTBEAT_MS = 25_000;

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsHub: EventsHub) {}

  @Sse('predictions/:predictionId')
  streamPrediction(
    @Param('predictionId') predictionId: string,
  ): Observable<MessageEvent> {
    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map(
        () =>
          ({
            type: 'ping',
            data: { ts: Date.now() },
          }) as MessageEvent,
      ),
    );
    return merge(this.eventsHub.subscribePrediction(predictionId), heartbeat$);
  }

  @Sse('experiments/:experimentId')
  streamExperiment(
    @Param('experimentId') experimentId: string,
  ): Observable<MessageEvent> {
    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map(
        () =>
          ({
            type: 'ping',
            data: { ts: Date.now() },
          }) as MessageEvent,
      ),
    );
    return merge(this.eventsHub.subscribeExperiment(experimentId), heartbeat$);
  }
}
