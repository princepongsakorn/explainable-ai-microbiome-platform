import { of, throwError } from 'rxjs';
import { AxiosError } from 'axios';
import { FindOperator } from 'typeorm';
import { PredictionProcessor } from './prediction.processor';
import { Prediction } from '../entity/prediction.entity';
import { PredictionRecord } from '../entity/prediction-record.entity';
import { PredictionStatus } from '../interface/prediction-class.enum';
import { pinnedVersionQuery, versionMismatch } from './model-version';

const BASE = 'http://inference.test';

/**
 * A stand-in for the inference service. It honours `?version=` the way the
 * runtime does and otherwise answers with whatever is in Production, which a
 * test can change between calls, the way a publish during a job would.
 */
function fakeInference() {
  const state = {
    production: '1',
    urls: [] as string[],
    /** Called after every request; lets a test publish mid-job. */
    afterCall: (() => undefined) as (count: number) => void,
    /** When set, the version answered no matter what was asked for. */
    forceVersion: null as string | null,
    /** Lets a test answer a predict call with an HTTP error or a doctored body. */
    predictReply: null as null | ((ids: string[]) => unknown),
  };

  const post = jest.fn((url: string, body: any) => {
    state.urls.push(url);
    const asked = new URL(url).searchParams.get('version');
    const version = state.forceVersion ?? asked ?? state.production;
    const ids: string[] = body.dataframe_split.index ?? ['row'];
    if (url.includes('/v1/predict/') && state.predictReply) {
      state.afterCall(state.urls.length);
      const reply = state.predictReply(ids);
      return reply instanceof Error
        ? throwError(() => reply)
        : of({ data: reply });
    }
    const data = url.includes('/v1/predict/')
      ? {
          predict: ids.map((id) => ({ id, proba: 0.8, class: 1 })),
          model_version: version,
        }
      : {
          contract_version: 1,
          values: ids.map(() => [0.1]),
          base_values: ids.map(() => 0.5),
          data: ids.map(() => [1]),
          feature_names: ['a'],
          sample_ids: ids,
          model_name: 'crc',
          model_version: version,
        };
    state.afterCall(state.urls.length);
    return of({ data });
  });

  return { state, http: { post } };
}

function prediction(modelVersion: string | null): Prediction {
  return {
    id: 'p1',
    prediction_number: 10000000,
    modelName: 'crc',
    modelVersion,
    dfColumns: ['a'],
    threshold: 0.5,
    createdAt: new Date(),
  } as Prediction;
}

function records(p: Prediction, n: number): PredictionRecord[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `r${i}`,
        record_number: 10000000 + i,
        prediction: p,
        dfData: [i],
        status: PredictionStatus.PENDING,
      }) as PredictionRecord,
  );
}

function build(p: Prediction, recs: PredictionRecord[]) {
  const inference = fakeInference();
  const predictionUpdates: Partial<Prediction>[] = [];
  const predictionsRepository = {
    findOne: jest.fn(async () => p),
    update: jest.fn(async (_id: string, fields: Partial<Prediction>) => {
      predictionUpdates.push(fields);
    }),
    save: jest.fn(async (x: unknown) => x),
  };
  const recordsRepository = {
    find: jest.fn(
      async (options?: { where?: { id?: FindOperator<string[]> } }) => {
        const ids = options?.where?.id?.value as string[] | undefined;
        return ids ? recs.filter((r) => ids.includes(r.id)) : recs;
      },
    ),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      recs.find((r) => r.id === where.id),
    ),
    save: jest.fn(async (x: unknown) => x),
  };
  const storage = {
    getPresignedUrl: jest.fn(async () => 'signed'),
    uploadJsonGzip: jest.fn(async () => 'explain-key'),
  };
  const config = {
    get: (key: string) => (key === 'INFERENCE_SERVICE_URL' ? BASE : undefined),
  };
  const events = { publishPrediction: jest.fn() };

  const processor = new PredictionProcessor(
    inference.http as any,
    predictionsRepository as any,
    recordsRepository as any,
    storage as any,
    config as any,
    events as any,
  );
  return { processor, inference, predictionUpdates };
}

const job = (data: object) =>
  ({ id: 1, data, queue: { getJob: async () => ({}) } }) as any;

/** What QueueService queues for these records: one chunk job. */
async function runRecords(
  processor: PredictionProcessor,
  recs: PredictionRecord[],
) {
  await processor.handlePredictionRecords(
    job({ predictionId: 'p1', recordIds: recs.map((r) => r.id) }),
  );
}

/** An error the way axios reports an HTTP error reply. */
function httpError(status: number, error: string) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    String(status),
    undefined,
    undefined,
    { status, data: { error } } as any,
  );
}

describe('pinnedVersionQuery', () => {
  it('pins a call to the version', () => {
    expect(pinnedVersionQuery('3')).toBe('?version=3');
  });

  it('adds nothing for a prediction made before pinning', () => {
    expect(pinnedVersionQuery(null)).toBe('');
    expect(pinnedVersionQuery(undefined)).toBe('');
  });
});

describe('versionMismatch', () => {
  it('accepts the pinned version', () => {
    expect(versionMismatch('1', '1', 'x')).toBeNull();
  });

  it('accepts anything for an unpinned prediction', () => {
    expect(versionMismatch(null, '7', 'x')).toBeNull();
  });

  it('names both versions when they differ', () => {
    expect(versionMismatch('1', '2', 'This result')).toMatch(
      /This result came from model version 2.*pinned to version 1/,
    );
  });
});

describe('PredictionProcessor with a pinned version', () => {
  it('keeps every record on the pinned version when Production changes mid-job', async () => {
    const p = prediction('1');
    const recs = records(p, 4);
    const { processor, inference } = build(p, recs);
    inference.state.afterCall = (count) => {
      if (count === 1) inference.state.production = '2';
    };

    // Two jobs, so Production moves between the two calls.
    await runRecords(processor, recs.slice(0, 2));
    await runRecords(processor, recs.slice(2));

    expect(inference.state.urls).toEqual([
      `${BASE}/v1/predict/crc?version=1`,
      `${BASE}/v1/predict/crc?version=1`,
    ]);
    for (const r of recs) {
      expect(r.status).toBe(PredictionStatus.SUCCESS);
      expect(r.modelVersion).toBe('1');
    }
  });

  it('keeps every explanation chunk on the pinned version when Production changes mid-job', async () => {
    const p = prediction('1');
    // Two chunks of CHUNK_SIZE = 50.
    const recs = records(p, 60);
    const { processor, inference, predictionUpdates } = build(p, recs);
    inference.state.afterCall = (count) => {
      if (count === 1) inference.state.production = '2';
    };

    await processor.handlePrediction(job({ predictionId: 'p1' }));

    expect(inference.state.urls).toEqual([
      `${BASE}/v1/explain/values/crc?version=1`,
      `${BASE}/v1/explain/values/crc?version=1`,
    ]);
    const saved = predictionUpdates.at(-1)!;
    expect(saved.explainError).toBeNull();
    expect(saved.explainModelVersion).toBe('1');
  });

  it('fails a record whose answer came from another version', async () => {
    const p = prediction('1');
    const recs = records(p, 1);
    const { processor, inference } = build(p, recs);
    inference.state.forceVersion = '2';

    await runRecords(processor, recs);

    expect(recs[0].status).toBe(PredictionStatus.ERROR);
    expect(recs[0].errorMsg).toMatch(/version 2.*pinned to version 1/);
    expect(recs[0].modelVersion).toBe('2');
    expect(recs[0].proba).toBeUndefined();
  });

  it('fails the explanation when it came from another version', async () => {
    const p = prediction('1');
    const recs = records(p, 3);
    const { processor, inference, predictionUpdates } = build(p, recs);
    inference.state.forceVersion = '2';

    await processor.handlePrediction(job({ predictionId: 'p1' }));

    const saved = predictionUpdates.at(-1)!;
    expect(saved.explainKey).toBeNull();
    expect(saved.explainError).toMatch(/version 2.*pinned to version 1/);
  });

  it('re-predicts and rebuilds with the pinned version after Production moved on', async () => {
    const p = prediction('1');
    const recs = records(p, 2);
    const { processor, inference } = build(p, recs);
    inference.state.production = '3';

    // What rePredictRecords and regenExplanation queue.
    await runRecords(processor, recs);
    await processor.handleRegenExplanation(job({ predictionId: 'p1' }));

    expect(inference.state.urls).toEqual([
      `${BASE}/v1/predict/crc?version=1`,
      `${BASE}/v1/explain/values/crc?version=1`,
    ]);
    expect(recs.map((r) => r.modelVersion)).toEqual(['1', '1']);
  });

  it('leaves a prediction made before pinning on Production, as before', async () => {
    const p = prediction(null);
    const recs = records(p, 2);
    const { processor, inference, predictionUpdates } = build(p, recs);
    inference.state.production = '5';

    await runRecords(processor, recs);
    await processor.handlePrediction(job({ predictionId: 'p1' }));

    expect(inference.state.urls).toEqual([
      `${BASE}/v1/predict/crc`,
      `${BASE}/v1/explain/values/crc`,
    ]);
    expect(recs.map((r) => r.status)).toEqual([
      PredictionStatus.SUCCESS,
      PredictionStatus.SUCCESS,
    ]);
    expect(recs.map((r) => r.modelVersion)).toEqual(['5', '5']);
    expect(predictionUpdates.at(-1)!.explainModelVersion).toBe('5');
  });
});

describe('PredictionProcessor predicting a chunk of records', () => {
  it('predicts a whole chunk in one call and matches results by id', async () => {
    const p = prediction('1');
    const recs = records(p, 3);
    const { processor, inference } = build(p, recs);
    // Answer out of order, with a distinct proba per record.
    inference.state.predictReply = (ids) => ({
      predict: [...ids]
        .reverse()
        .map((id) => ({ id, proba: Number(id.slice(1)) / 10, class: 1 })),
      model_version: '1',
    });

    await runRecords(processor, recs);

    expect(inference.state.urls).toEqual([`${BASE}/v1/predict/crc?version=1`]);
    const body = inference.http.post.mock.calls[0][1];
    expect(body.dataframe_split.index).toEqual(['r0', 'r1', 'r2']);
    expect(body.dataframe_split.data).toEqual([[0], [1], [2]]);
    expect(recs.map((r) => r.proba)).toEqual([0, 0.1, 0.2]);
    expect(recs.map((r) => r.status)).toEqual([
      PredictionStatus.SUCCESS,
      PredictionStatus.SUCCESS,
      PredictionStatus.SUCCESS,
    ]);
  });

  it('fails only the record the runtime gave no answer for', async () => {
    const p = prediction('1');
    const recs = records(p, 3);
    const { processor, inference } = build(p, recs);
    inference.state.predictReply = (ids) => ({
      predict: ids
        .filter((id) => id !== 'r1')
        .map((id) => ({ id, proba: 0.8, class: 1 })),
      model_version: '1',
    });

    await runRecords(processor, recs);

    expect(recs.map((r) => r.status)).toEqual([
      PredictionStatus.SUCCESS,
      PredictionStatus.ERROR,
      PredictionStatus.SUCCESS,
    ]);
    expect(recs[1].errorMsg).toBe(
      'Prediction service returned an empty result',
    );
  });

  it('asks again one record at a time when the runtime refuses the chunk', async () => {
    const p = prediction('1');
    const recs = records(p, 3);
    const { processor, inference } = build(p, recs);
    inference.state.predictReply = (ids) =>
      ids.includes('r2')
        ? httpError(
            400,
            'These columns contain values that are not numbers: a.',
          )
        : {
            predict: ids.map((id) => ({ id, proba: 0.8, class: 1 })),
            model_version: '1',
          };

    await runRecords(processor, recs);

    // The chunk, then each of its three records.
    expect(inference.state.urls).toHaveLength(4);
    expect(recs.map((r) => r.status)).toEqual([
      PredictionStatus.SUCCESS,
      PredictionStatus.SUCCESS,
      PredictionStatus.ERROR,
    ]);
    expect(recs[2].errorMsg).toMatch(/not numbers/);
  });

  it("fails every record of the chunk with the runtime's reason on a server error", async () => {
    const p = prediction('1');
    const recs = records(p, 2);
    const { processor, inference } = build(p, recs);
    inference.state.predictReply = () => httpError(503, 'Model failed to load');

    await runRecords(processor, recs);

    expect(inference.state.urls).toHaveLength(1);
    for (const r of recs) {
      expect(r.status).toBe(PredictionStatus.ERROR);
      expect(r.errorMsg).toBe('Model failed to load');
    }
  });

  it('still runs a one-record job queued before chunking', async () => {
    const p = prediction('1');
    const recs = records(p, 2);
    const { processor, inference } = build(p, recs);

    await processor.handlePredictionRecord(
      job({ predictionId: 'p1', recordId: 'r1' }),
    );

    expect(inference.state.urls).toEqual([`${BASE}/v1/predict/crc?version=1`]);
    expect(recs.map((r) => r.status)).toEqual([
      PredictionStatus.PENDING,
      PredictionStatus.SUCCESS,
    ]);
  });

  it('cancels the chunk when its job was removed', async () => {
    const p = prediction('1');
    const recs = records(p, 2);
    const { processor, inference } = build(p, recs);
    const removed = {
      id: 1,
      data: { predictionId: 'p1', recordIds: ['r0', 'r1'] },
      queue: { getJob: async () => null },
    } as any;

    await processor.handlePredictionRecords(removed);

    expect(inference.state.urls).toHaveLength(0);
    for (const r of recs) expect(r.status).toBe(PredictionStatus.CANCELED);
  });
});
