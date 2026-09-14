/**
 * Assembling one Explanation payload out of several chunked responses.
 *
 * See docs/shap-explain-spec.md §2.2. The Python service is called with a slice of
 * the Samples at a time so that no single HTTP call is long enough to be scary, and
 * so a failure retries one slice instead of the whole matrix.
 */

/** Samples per HTTP call to the Python service. */
export const CHUNK_SIZE = 50;

/** Samples per Prediction, enforced at upload (spec §2.1). */
export const MAX_SAMPLES_PER_PREDICTION = 500;

/** The wire shape defined in docs/shap-explain-spec.md §1. */
export interface ExplainPayload {
  contract_version: number;
  /** n x p */
  values: number[][];
  /** n — one per Sample, never collapsed to Sample 0's value */
  base_values: number[];
  /** n x p */
  data: number[][];
  /** p */
  feature_names: string[];
  /** n, when the caller supplied identifiers */
  sample_ids?: string[];
  /**
   * n — what a person reads for each Sample. `sample_ids` stays the join key:
   * a label comes from an uploaded file, so nothing guarantees it is unique.
   */
  sample_labels?: string[];
  /** Header of the uploaded column the labels came from, when it had one. */
  sample_label_column?: string;
  model_name?: string;
  model_version?: string;
  output_names?: string[];
}

/** Half-open `[start, end)` ranges covering `total` items. */
export function chunkIndices(
  total: number,
  size: number = CHUNK_SIZE,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < total; start += size) {
    ranges.push([start, Math.min(start + size, total)]);
  }
  return ranges;
}

/**
 * Join per-chunk payloads into one.
 *
 * Safe because a Sample's SHAP values do not depend on which other Samples shared
 * its request — the Explainer's background is fixed inside the model artifact. And
 * nothing that needs to see every Sample at once happens in Python: feature
 * ordering, colour scaling and instance ordering are all computed in the browser.
 */
export function concatPayloads(chunks: ExplainPayload[]): ExplainPayload {
  if (chunks.length === 0) {
    throw new Error('concatPayloads needs at least one chunk');
  }

  const [first] = chunks;
  const featureNames = JSON.stringify(first.feature_names);

  for (const [index, chunk] of chunks.entries()) {
    if (chunk.contract_version !== first.contract_version) {
      throw new Error(
        `chunk ${index} has contract_version ${chunk.contract_version} but the first has ` +
          `${first.contract_version}; refusing to concatenate`,
      );
    }
    if (JSON.stringify(chunk.feature_names) !== featureNames) {
      throw new Error(
        `chunk ${index} has different feature_names from the first; refusing to concatenate`,
      );
    }
    // A job runs for minutes, and the runtime follows Production promotions
    // while it does. Values from two models are not one Explanation.
    if ((chunk.model_version ?? null) !== (first.model_version ?? null)) {
      throw new Error(
        `chunk ${index} was explained by model version ${chunk.model_version ?? 'unknown'} ` +
          `but the first by ${first.model_version ?? 'unknown'}; the model changed ` +
          `during the job, so rebuild the explanation`,
      );
    }
  }

  // Absent sample_ids is meaningful — a third-party payload need not carry them —
  // so only emit the field when at least one chunk did.
  const sampleIds = chunks.some((chunk) => chunk.sample_ids)
    ? chunks.flatMap((chunk) => chunk.sample_ids ?? [])
    : undefined;
  const sampleLabels = chunks.some((chunk) => chunk.sample_labels)
    ? chunks.flatMap((chunk) => chunk.sample_labels ?? [])
    : undefined;

  return {
    contract_version: first.contract_version,
    feature_names: first.feature_names,
    values: chunks.flatMap((chunk) => chunk.values),
    base_values: chunks.flatMap((chunk) => chunk.base_values),
    data: chunks.flatMap((chunk) => chunk.data),
    ...(sampleIds ? { sample_ids: sampleIds } : {}),
    ...(sampleLabels ? { sample_labels: sampleLabels } : {}),
    ...(first.sample_label_column
      ? { sample_label_column: first.sample_label_column }
      : {}),
    ...(first.model_name ? { model_name: first.model_name } : {}),
    ...(first.model_version ? { model_version: first.model_version } : {}),
    ...(first.output_names ? { output_names: first.output_names } : {}),
  };
}

/**
 * Extract one Sample's Explanation from the stored matrix.
 *
 * This is what backs the per-record route: a slice, never a recomputation. Each
 * Sample keeps **its own** base value — taking the first row's would reintroduce
 * exactly the bug the per-Sample contract exists to prevent (spec §1.3).
 */
export function sliceSample(
  payload: ExplainPayload,
  sampleId: string,
): ExplainPayload {
  if (!payload.sample_ids) {
    throw new Error(
      'this Explanation carries no sample_ids, so a single Sample cannot be addressed',
    );
  }

  const index = payload.sample_ids.indexOf(sampleId);
  if (index < 0) {
    throw new Error(`sample ${sampleId} is not in this Explanation`);
  }

  return {
    contract_version: payload.contract_version,
    values: [payload.values[index]],
    base_values: [payload.base_values[index]],
    data: [payload.data[index]],
    feature_names: payload.feature_names,
    sample_ids: [sampleId],
    ...(payload.sample_labels
      ? { sample_labels: [payload.sample_labels[index]] }
      : {}),
    ...(payload.sample_label_column
      ? { sample_label_column: payload.sample_label_column }
      : {}),
    ...(payload.model_name ? { model_name: payload.model_name } : {}),
    ...(payload.model_version ? { model_version: payload.model_version } : {}),
    ...(payload.output_names ? { output_names: payload.output_names } : {}),
  };
}

/** The parts of a Prediction Record a label is built from. */
export interface LabelSource {
  record_number: number;
  /** The uploaded row: the first element is the file's first column. */
  dfData: (string | number)[];
}

/**
 * Human-readable names for each Sample, in the records' order.
 *
 * The first uploaded column is taken as the Sample identifier **unless its
 * header is one of the model's features** — then the file has no identifier
 * column and its first column is a taxon. That test is by meaning, not by name:
 * real files call the column `sample_id`, `subject_id`, or leave the header
 * blank (a pandas index), and some studies use plain numbers as ids, so neither
 * a name list nor "is it non-numeric" would hold.
 *
 * A Sample with no usable id — no identifier column, or a blank cell — falls
 * back to its record number, prefixed so it cannot be mistaken for a numeric id
 * from the file.
 */
export function sampleLabelsFor(
  records: LabelSource[],
  dfColumns: string[],
  featureNames: string[],
): Pick<ExplainPayload, 'sample_labels' | 'sample_label_column'> {
  const header = dfColumns[0] ?? '';
  const hasIdColumn = dfColumns.length > 0 && !featureNames.includes(header);

  const sample_labels = records.map((record) => {
    const cell = hasIdColumn ? String(record.dfData[0] ?? '').trim() : '';
    return cell !== '' ? cell : `Record #${record.record_number}`;
  });

  const column = hasIdColumn ? header.trim() : '';
  return column
    ? { sample_labels, sample_label_column: column }
    : { sample_labels };
}

/** The outcome of adding labels to one stored payload. */
export type BackfillResult =
  | { status: 'updated'; payload: ExplainPayload }
  | { status: 'skipped'; reason: string };

/**
 * Add sample_labels to a payload that was built before labels existed.
 *
 * Records are joined to Samples through sample_ids, which are record UUIDs, so
 * the order records arrive in does not matter. Only the two label fields are
 * added; every value, base value and id is left exactly as stored.
 *
 * A payload is skipped rather than guessed at when it already has labels (so a
 * second run is harmless), when it has no sample_ids to join on, or when any of
 * its Samples has no matching record.
 */
export function backfillSampleLabels(
  payload: ExplainPayload,
  records: Array<LabelSource & { id: string }>,
  dfColumns: string[],
): BackfillResult {
  if (payload.sample_labels) {
    return { status: 'skipped', reason: 'already has sample_labels' };
  }
  if (!payload.sample_ids) {
    return {
      status: 'skipped',
      reason: 'has no sample_ids to join records on',
    };
  }

  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered = payload.sample_ids.map((id) => byId.get(id));
  const missing = ordered.filter((record) => record === undefined).length;
  if (missing > 0) {
    return {
      status: 'skipped',
      reason: `${missing} of ${payload.sample_ids.length} sample_ids have no matching record`,
    };
  }

  return {
    status: 'updated',
    payload: {
      ...payload,
      ...sampleLabelsFor(
        ordered as Array<LabelSource & { id: string }>,
        dfColumns,
        payload.feature_names,
      ),
    },
  };
}
