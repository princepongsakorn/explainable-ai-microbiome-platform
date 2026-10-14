import { of } from 'rxjs';
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
  };

  const post = jest.fn((url: string, body: any) => {
    state.urls.push(url);
    const asked = new URL(url).searchParams.get('version');
    const version = state.forceVersion ?? asked ?? state.production;
    const ids: string[] = body.dataframe_split.index ?? ['row'];
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
    find: jest.fn(async () => recs),
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

async function runRecords(
  processor: PredictionProcessor,
  recs: PredictionRecord[],
) {
  for (const r of recs) {
    await processor.handlePredictionRecord(
      job({ predictionId: 'p1', recordId: r.id }),
    );
  }
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

    await runRecords(processor, recs);

    expect(inference.state.urls).toHaveLength(4);
    for (const url of inference.state.urls) {
      expect(url).toBe(`${BASE}/v1/predict/crc?version=1`);
    }
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
