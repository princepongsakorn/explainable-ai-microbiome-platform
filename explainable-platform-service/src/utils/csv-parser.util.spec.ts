import { InvalidCsvError, toNumericRows } from './csv-parser.util';

const columns = [
  'subject_id',
  'Fusobacterium_nucleatum',
  'Bacteroides_fragilis',
];

describe('toNumericRows', () => {
  it('converts every cell to a number', () => {
    expect(toNumericRows(columns, [['s1', '0.0042', '0']])).toEqual([
      ['s1', 0.0042, 0],
    ]);
  });

  it('treats an empty cell as a true biological zero, not missing data', () => {
    expect(toNumericRows(columns, [['s1', '', '0.5']])).toEqual([
      ['s1', 0, 0.5],
    ]);
  });

  it('accepts scientific notation and negative numbers', () => {
    expect(toNumericRows(columns, [['s1', '3e-4', '-0.25']])).toEqual([
      ['s1', 0.0003, -0.25],
    ]);
  });

  it('leaves the first column alone — it is an identifier, not a measurement', () => {
    expect(toNumericRows(columns, [['SAMD00114722', '1', '2']])[0][0]).toBe(
      'SAMD00114722',
    );
  });

  it('rejects a non-numeric cell, naming the row and the column', () => {
    expect(() => toNumericRows(columns, [['s1', '0.1', 'n/a']])).toThrow(
      InvalidCsvError,
    );
    expect(() => toNumericRows(columns, [['s1', '0.1', 'n/a']])).toThrow(
      /Row 2.*Bacteroides_fragilis.*"n\/a"/,
    );
  });

  it('reports the spreadsheet row number, counting the header as row 1', () => {
    const rows = [
      ['s1', '1', '2'],
      ['s2', '3', 'oops'],
    ];
    expect(() => toNumericRows(columns, rows)).toThrow(/Row 3/);
  });

  it('rejects Infinity and NaN spelled out, which JSON cannot represent', () => {
    expect(() => toNumericRows(columns, [['s1', 'Infinity', '0']])).toThrow(
      InvalidCsvError,
    );
    expect(() => toNumericRows(columns, [['s1', 'NaN', '0']])).toThrow(
      InvalidCsvError,
    );
  });

  it('rejects a row with more cells than there are columns', () => {
    expect(() => toNumericRows(columns, [['s1', '1', '2', '3']])).toThrow(
      /4 values but the header has 3/,
    );
  });

  it('fills the missing trailing cells of a short row with zeros', () => {
    expect(toNumericRows(columns, [['s1', '1']])).toEqual([['s1', 1, 0]]);
  });

  it('accepts an empty set of rows', () => {
    expect(toNumericRows(columns, [])).toEqual([]);
  });
});
