import { QueueService, PREDICT_CHUNK_SIZE } from './queue.service';

function build(jobs: { id: number; data: object }[] = []) {
  const removed: number[] = [];
  const queue = {
    add: jest.fn(async () => undefined),
    getJobs: jest.fn(async () => jobs),
    getJob: jest.fn(async (id: number) => ({
      isActive: async () => false,
      isWaiting: async () => true,
      isDelayed: async () => false,
      remove: async () => removed.push(id),
    })),
  };
  const records = { update: jest.fn(async () => undefined) };
  return {
    service: new QueueService(queue as any, records as any),
    queue,
    removed,
  };
}

describe('QueueService', () => {
  it('queues records in chunks, in the order given', async () => {
    const { service, queue } = build();
    const ids = Array.from(
      { length: 2 * PREDICT_CHUNK_SIZE + 3 },
      (_, i) => `r${i}`,
    );

    await service.addPredictionRecordJobs('p1', ids);

    const chunks = queue.add.mock.calls.map(([name, data]: any[]) => {
      expect(name).toBe('processPredictionRecords');
      expect(data.predictionId).toBe('p1');
      return data.recordIds;
    });
    expect(chunks.map((c: string[]) => c.length)).toEqual([
      PREDICT_CHUNK_SIZE,
      PREDICT_CHUNK_SIZE,
      3,
    ]);
    expect(chunks.flat()).toEqual(ids);
  });

  it('cancels chunk jobs and one-record jobs of the prediction only', async () => {
    const { service, removed } = build([
      { id: 1, data: { predictionId: 'p1', recordIds: ['r0', 'r1'] } },
      { id: 2, data: { predictionId: 'p1', recordId: 'r2' } },
      { id: 3, data: { predictionId: 'p1' } },
      { id: 4, data: { predictionId: 'p2', recordIds: ['x'] } },
    ]);

    await service.cancelPredictionJob('p1');

    expect(removed).toEqual([1, 2]);
  });
});
