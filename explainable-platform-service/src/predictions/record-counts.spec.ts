import { PredictionStatus } from '../interface/prediction-class.enum';
import { RecordCountRow, emptyRecordCounts, foldRecordCounts } from './record-counts';

const row = (
  predictionId: string,
  status: PredictionStatus,
  cls: number | null,
  count: string | number,
): RecordCountRow => ({ predictionId, status, class: cls, count });

describe('foldRecordCounts', () => {
  it('counts every status and keeps total, success and error in step', () => {
    const counts = foldRecordCounts(
      ['p1'],
      [
        row('p1', PredictionStatus.SUCCESS, 1, '12'),
        row('p1', PredictionStatus.SUCCESS, 0, '26'),
        row('p1', PredictionStatus.ERROR, null, '2'),
        row('p1', PredictionStatus.PENDING, null, '3'),
        row('p1', PredictionStatus.IN_PROGRESS, null, '1'),
        row('p1', PredictionStatus.CANCELED, null, '4'),
      ],
    );
    expect(counts.get('p1')).toEqual({
      total: 48,
      success: 38,
      error: 2,
      byStatus: { PENDING: 3, IN_PROGRESS: 1, SUCCESS: 38, ERROR: 2, CANCELED: 4 },
      byClass: { '0': 26, '1': 12 },
    });
  });

  it('counts unclassified samples in the total but not in byClass', () => {
    const counts = foldRecordCounts(['p1'], [row('p1', PredictionStatus.PENDING, null, '5')]);
    expect(counts.get('p1')?.total).toBe(5);
    expect(counts.get('p1')?.byClass).toEqual({});
  });

  it('keeps class values other than 0 and 1, and numeric counts', () => {
    const counts = foldRecordCounts(
      ['p1'],
      [
        row('p1', PredictionStatus.SUCCESS, -1, 4),
        row('p1', PredictionStatus.SUCCESS, 2, 6),
      ],
    );
    expect(counts.get('p1')?.byClass).toEqual({ '-1': 4, '2': 6 });
  });

  it('gives a prediction with no rows zeros and an empty byClass', () => {
    expect(foldRecordCounts(['p1'], []).get('p1')).toEqual(emptyRecordCounts());
  });

  it('ignores rows for predictions it was not asked about', () => {
    const counts = foldRecordCounts(['p1'], [row('p2', PredictionStatus.SUCCESS, 1, '9')]);
    expect(counts.has('p2')).toBe(false);
    expect(counts.get('p1')?.total).toBe(0);
  });
});
