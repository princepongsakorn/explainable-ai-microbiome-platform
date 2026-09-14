import { MessageEvent } from '@nestjs/common';
import { firstValueFrom, take, toArray } from 'rxjs';
import { EventsHub, EventsRedis } from './events.hub';

/**
 * A pair of fakes wired the way ioredis behaves: publishing on one delivers to the
 * other's `message` listeners, but only for channels it has subscribed to.
 */
function fakeRedisPair() {
  const listeners: Array<(channel: string, message: string) => void> = [];
  const subscribed = new Set<string>();
  let publishFails = false;

  const sub: EventsRedis = {
    publish: () => Promise.resolve(0),
    subscribe: (...channels: string[]) => {
      channels.forEach((c) => subscribed.add(c));
      return Promise.resolve(channels.length);
    },
    unsubscribe: (...channels: string[]) => {
      channels.forEach((c) => subscribed.delete(c));
      return Promise.resolve(channels.length);
    },
    on: (_event, cb) => {
      listeners.push(cb);
      return sub;
    },
    quit: () => Promise.resolve('OK'),
    disconnect: () => undefined,
  };

  const pub: EventsRedis = {
    publish: (channel: string, message: string) => {
      if (publishFails) return Promise.reject(new Error('redis down'));
      if (subscribed.has(channel)) {
        listeners.forEach((cb) => cb(channel, message));
      }
      return Promise.resolve(1);
    },
    subscribe: () => Promise.resolve(0),
    unsubscribe: () => Promise.resolve(0),
    on: () => pub,
    quit: () => Promise.resolve('OK'),
    disconnect: () => undefined,
  };

  return {
    pub,
    sub,
    subscribed,
    /** Simulate an event published by a different pod. */
    deliverFromElsewhere: (channel: string, message: string) =>
      listeners.forEach((cb) => cb(channel, message)),
    breakPublish: () => {
      publishFails = true;
    },
  };
}

describe('EventsHub', () => {
  it('delivers an event published here to a local subscriber', async () => {
    const redis = fakeRedisPair();
    const hub = new EventsHub(redis.pub, redis.sub);

    const received = firstValueFrom(
      hub.subscribe('prediction:p1').pipe(take(1)),
    );
    await hub.flush();
    hub.publish('prediction:p1', 'thing:happened', { n: 1 });

    await expect(received).resolves.toMatchObject({
      type: 'thing:happened',
      data: { n: 1 },
    });
  });

  it('delivers an event published by another pod', async () => {
    const redis = fakeRedisPair();
    const hub = new EventsHub(redis.pub, redis.sub);

    const received = firstValueFrom(
      hub.subscribe('prediction:p1').pipe(take(1)),
    );
    await hub.flush();

    redis.deliverFromElsewhere(
      'events:prediction:p1',
      JSON.stringify({ type: 'remote', data: { from: 'pod-b' } }),
    );

    await expect(received).resolves.toMatchObject({
      type: 'remote',
      data: { from: 'pod-b' },
    });
  });

  it('publishes even when nobody is listening on this pod', async () => {
    const redis = fakeRedisPair();
    const publish = jest.spyOn(redis.pub, 'publish');
    const hub = new EventsHub(redis.pub, redis.sub);

    hub.publish('prediction:nobody-here', 'thing', { n: 1 });
    await hub.flush();

    expect(publish).toHaveBeenCalledWith(
      'events:prediction:nobody-here',
      expect.stringContaining('thing'),
    );
  });

  it('subscribes to the Redis channel only while a local subscriber exists', async () => {
    const redis = fakeRedisPair();
    const hub = new EventsHub(redis.pub, redis.sub);

    const subscription = hub
      .subscribe('prediction:p1')
      .subscribe(() => undefined);
    await hub.flush();
    expect(redis.subscribed.has('events:prediction:p1')).toBe(true);

    subscription.unsubscribe();
    await hub.flush();
    expect(redis.subscribed.has('events:prediction:p1')).toBe(false);
  });

  it('still delivers locally when Redis is unreachable', async () => {
    const redis = fakeRedisPair();
    const hub = new EventsHub(redis.pub, redis.sub);

    const received = firstValueFrom(
      hub.subscribe('prediction:p1').pipe(take(1)),
    );
    await hub.flush();
    redis.breakPublish();

    hub.publish('prediction:p1', 'degraded', { n: 2 });

    await expect(received).resolves.toMatchObject({ type: 'degraded' });
  });

  it('does not deliver an event twice when Redis is healthy', async () => {
    const redis = fakeRedisPair();
    const hub = new EventsHub(redis.pub, redis.sub);

    const collected = firstValueFrom(
      hub.subscribe('prediction:p1').pipe(take(2), toArray()),
    );
    await hub.flush();

    hub.publish('prediction:p1', 'first', { n: 1 });
    await hub.flush();
    hub.publish('prediction:p1', 'second', { n: 2 });

    const events: MessageEvent[] = await collected;
    expect(events.map((e) => e.type)).toEqual(['first', 'second']);
  });

  it('keeps the prediction and experiment helpers working', async () => {
    const redis = fakeRedisPair();
    const hub = new EventsHub(redis.pub, redis.sub);

    const received = firstValueFrom(
      hub.subscribePrediction('p9').pipe(take(1)),
    );
    await hub.flush();
    hub.publishPrediction('p9', 'prediction:explanation', { ready: true });

    await expect(received).resolves.toMatchObject({
      type: 'prediction:explanation',
      data: { ready: true },
    });
  });
});
