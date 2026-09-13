import {
  CHUNK_SIZE,
  ExplainPayload,
  chunkIndices,
  concatPayloads,
  backfillSampleLabels,
  sampleLabelsFor,
  sliceSample,
} from './explain.builder';

const chunk = (ids: string[], value: number): ExplainPayload => ({
  contract_version: 1,
  values: ids.map(() => [value, -value]),
  base_values: ids.map(() => 0.5),
  data: ids.map(() => [1, 2]),
  feature_names: ['a', 'b'],
  sample_ids: ids,
  model_name: 'crc-test',
});

describe('chunkIndices', () => {
  it('splits a count into half-open ranges of at most CHUNK_SIZE', () => {
    expect(chunkIndices(120, 50)).toEqual([
      [0, 50],
      [50, 100],
      [100, 120],
    ]);
  });

  it('returns a single range when the count fits in one chunk', () => {
    expect(chunkIndices(7, 50)).toEqual([[0, 7]]);
  });

  it('returns nothing for an empty set rather than an empty range', () => {
    expect(chunkIndices(0, 50)).toEqual([]);
  });

  it('defaults to CHUNK_SIZE', () => {
    expect(chunkIndices(CHUNK_SIZE + 1)).toHaveLength(2);
  });
});

describe('concatPayloads', () => {
  it('concatenates rows in order and keeps one copy of the shared fields', () => {
    const out = concatPayloads([chunk(['s1', 's2'], 1), chunk(['s3'], 2)]);

    expect(out.sample_ids).toEqual(['s1', 's2', 's3']);
    expect(out.values).toHaveLength(3);
    expect(out.values[2]).toEqual([2, -2]);
    expect(out.base_values).toEqual([0.5, 0.5, 0.5]);
    expect(out.data).toHaveLength(3);
    expect(out.feature_names).toEqual(['a', 'b']);
    expect(out.contract_version).toBe(1);
    expect(out.model_name).toBe('crc-test');
  });

  it('passes a single chunk through unchanged', () => {
    const only = chunk(['s1'], 3);
    expect(concatPayloads([only])).toEqual(only);
  });

  it('rejects chunks whose feature_names disagree', () => {
    const bad = { ...chunk(['s3'], 2), feature_names: ['a', 'c'] };
    expect(() => concatPayloads([chunk(['s1'], 1), bad])).toThrow(/feature_names/);
  });

  it('rejects chunks whose contract_version disagrees', () => {
    const bad = { ...chunk(['s3'], 2), contract_version: 2 };
    expect(() => concatPayloads([chunk(['s1'], 1), bad])).toThrow(/contract_version/);
  });

  it('rejects an empty chunk list', () => {
    expect(() => concatPayloads([])).toThrow(/at least one/);
  });

  it('omits sample_ids entirely when no chunk carried them', () => {
    const withoutIds = (ids: string[]) => {
      const { sample_ids, ...rest } = chunk(ids, 1);
      return rest as ExplainPayload;
    };
    const out = concatPayloads([withoutIds(['s1']), withoutIds(['s2'])]);
    expect(out.sample_ids).toBeUndefined();
  });

  it('keeps every row, so a 500-sample matrix survives ten chunks intact', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `s${i}`);
    const chunks = chunkIndices(ids.length).map(([start, end]) =>
      chunk(ids.slice(start, end), 1),
    );

    expect(chunks).toHaveLength(10);

    const out = concatPayloads(chunks);
    expect(out.values).toHaveLength(500);
    expect(out.base_values).toHaveLength(500);
    expect(out.data).toHaveLength(500);
    expect(out.sample_ids).toEqual(ids);
  });
});

describe('sliceSample', () => {
  const payload: ExplainPayload = {
    contract_version: 1,
    values: [
      [1, -2],
      [3, 4],
      [5, -6],
    ],
    base_values: [0.1, 0.2, 0.3],
    data: [
      [10, 20],
      [30, 40],
      [50, 60],
    ],
    feature_names: ['a', 'b'],
    sample_ids: ['s1', 's2', 's3'],
    model_name: 'crc-test',
    model_version: '4',
  };

  it('returns a one-Sample payload for the requested id', () => {
    expect(sliceSample(payload, 's2')).toEqual({
      contract_version: 1,
      values: [[3, 4]],
      base_values: [0.2],
      data: [[30, 40]],
      feature_names: ['a', 'b'],
      sample_ids: ['s2'],
      model_name: 'crc-test',
      model_version: '4',
    });
  });

  it('takes that Sample own base value, not the first one', () => {
    expect(sliceSample(payload, 's3').base_values).toEqual([0.3]);
  });

  it('throws a named error when the Sample is not in the payload', () => {
    expect(() => sliceSample(payload, 'nope')).toThrow(/nope/);
  });

  it('throws when the payload carries no sample_ids at all', () => {
    const { sample_ids, ...anonymous } = payload;
    expect(() => sliceSample(anonymous as ExplainPayload, 's1')).toThrow(
      /sample_ids/,
    );
  });

  it('preserves additivity: base + sum(values) is unchanged by slicing', () => {
    const whole = payload.base_values[1] + payload.values[1].reduce((a, b) => a + b, 0);
    const sliced = sliceSample(payload, 's2');
    const part = sliced.base_values[0] + sliced.values[0].reduce((a, b) => a + b, 0);
    expect(part).toBeCloseTo(whole, 10);
  });
});

describe('sampleLabelsFor', () => {
  const features = ['Bacteroides_dorei', 'Parvimonas_micra'];
  const record = (recordNumber: number, first: string | number) => ({
    record_number: recordNumber,
    dfData: [first, 0.1, 0.2],
  });

  it('labels each Sample with the id from the file first column, and names that column', () => {
    expect(
      sampleLabelsFor(
        [record(7, 'SAMD00114722'), record(8, 'SAMD00114723')],
        ['sample_id', ...features],
        features,
      ),
    ).toEqual({
      sample_labels: ['SAMD00114722', 'SAMD00114723'],
      sample_label_column: 'sample_id',
    });
  });

  it('keeps a numeric id as text, since some studies number their subjects', () => {
    expect(
      sampleLabelsFor([record(7, 10037)], ['subject_id', ...features], features)
        .sample_labels,
    ).toEqual(['10037']);
  });

  it('omits the column name when the header is blank, as a pandas index writes it', () => {
    const out = sampleLabelsFor([record(7, 'AHCNC2ADXX')], ['', ...features], features);
    expect(out.sample_labels).toEqual(['AHCNC2ADXX']);
    expect(out.sample_label_column).toBeUndefined();
  });

  it('falls back to the record number when the first column is a model feature', () => {
    // Then the file has no id column at all: its first column is a taxon.
    expect(
      sampleLabelsFor([record(7, 0.1), record(8, 0.3)], features, features),
    ).toEqual({ sample_labels: ['Record #7', 'Record #8'] });
  });

  it('falls back for one Sample whose id cell is blank, without affecting the others', () => {
    expect(
      sampleLabelsFor(
        [record(7, 'A'), record(8, '   ')],
        ['sample_id', ...features],
        features,
      ).sample_labels,
    ).toEqual(['A', 'Record #8']);
  });
});

describe('sample labels through concat and slice', () => {
  it('concatenates sample_labels in order and keeps the column name', () => {
    const out = concatPayloads([
      { ...chunk(['a'], 1), sample_labels: ['SAMD1'], sample_label_column: 'sample_id' },
      { ...chunk(['b'], 2), sample_labels: ['SAMD2'], sample_label_column: 'sample_id' },
    ]);
    expect(out.sample_labels).toEqual(['SAMD1', 'SAMD2']);
    expect(out.sample_label_column).toBe('sample_id');
  });

  it('slices a Sample own label, never another Sample', () => {
    const payload = {
      ...chunk(['a', 'b'], 1),
      sample_labels: ['SAMD1', 'SAMD2'],
      sample_label_column: 'subject_id',
    };
    const one = sliceSample(payload, 'b');
    expect(one.sample_labels).toEqual(['SAMD2']);
    expect(one.sample_label_column).toBe('subject_id');
  });
});

describe('backfillSampleLabels', () => {
  // chunk() gives sample_ids in order and feature_names ['a', 'b'].
  const payload = () => chunk(['uuid-1', 'uuid-2'], 1);
  const columns = ['sample_id', 'a', 'b'];
  // Deliberately out of order: the join must not depend on it.
  const records = [
    { id: 'uuid-2', record_number: 8, dfData: ['SAMD2', 0, 0] },
    { id: 'uuid-1', record_number: 7, dfData: ['SAMD1', 0, 0] },
  ];

  it('joins records to Samples by UUID, not by the order they arrive in', () => {
    const result = backfillSampleLabels(payload(), records, columns);
    expect(result.status).toBe('updated');
    if (result.status !== 'updated') return;
    expect(result.payload.sample_labels).toEqual(['SAMD1', 'SAMD2']);
    expect(result.payload.sample_label_column).toBe('sample_id');
  });

  it('changes nothing but the two label fields', () => {
    const before = payload();
    const result = backfillSampleLabels(before, records, columns);
    if (result.status !== 'updated') throw new Error('expected an update');
    const { sample_labels, sample_label_column, ...rest } = result.payload;
    expect(rest).toEqual(before);
  });

  it('skips a payload that already has labels, so running it twice is harmless', () => {
    const labelled = { ...payload(), sample_labels: ['x', 'y'] };
    expect(backfillSampleLabels(labelled, records, columns)).toEqual({
      status: 'skipped',
      reason: 'already has sample_labels',
    });
  });

  it('skips a payload without sample_ids, which cannot be joined to records', () => {
    const { sample_ids, ...noIds } = payload();
    const result = backfillSampleLabels(noIds, records, columns);
    expect(result.status).toBe('skipped');
  });

  it('skips when a Sample has no record, rather than labelling it by guesswork', () => {
    const result = backfillSampleLabels(payload(), [records[0]], columns);
    expect(result).toEqual({
      status: 'skipped',
      reason: '1 of 2 sample_ids have no matching record',
    });
  });
});

