import { Multer } from 'multer';
import { Readable } from 'stream';
import * as Papa from 'papaparse';

/** A caller's file cannot be read as a numeric matrix. */
export class InvalidCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCsvError';
  }
}

export async function parseCsv(
  file: Multer.File,
): Promise<{ dfColumns: string[]; dfDataRows: any[][] }> {
  return new Promise((resolve, reject) => {
    const stream = Readable.from(file.buffer);
    Papa.parse(stream, {
      // Without this, a file ending in a newline yields a trailing [''] row,
      // which becomes an empty PredictionRecord and then an unexplainable
      // all-missing Sample.
      skipEmptyLines: true,
      complete: (result) => {
        const csvData = result?.data as any[][];
        if (!csvData?.length) {
          reject(new InvalidCsvError('The file has no rows.'));
          return;
        }
        resolve({ dfColumns: csvData[0], dfDataRows: csvData.slice(1) });
      },
      error: (error: Error) =>
        reject(new InvalidCsvError(`The file could not be read: ${error.message}`)),
    });
  });
}

/**
 * Convert every measurement cell to a number, refusing anything that is not one.
 *
 * Two rules from docs/shap-explain-spec.md §2.1, and together they are what lets
 * the payload promise it contains no `NaN`:
 *
 *   - an empty cell is an **absent taxon**, which is a true biological zero, not
 *     missing data — the model was trained on that meaning;
 *   - anything else that is not a number is bad input, and the caller is told
 *     which row and column rather than having it silently coerced.
 *
 * Coercing instead (what `pd.to_numeric(errors="coerce")` does downstream) would
 * turn a typo into a `NaN`, which is not valid JSON and which no chart can draw.
 *
 * The first column is the Sample identifier and is left as written.
 */
export function toNumericRows(
  columns: string[],
  rows: any[][],
): (string | number)[][] {
  return rows.map((row, rowIndex) => {
    if (row.length > columns.length) {
      throw new InvalidCsvError(
        `Row ${rowIndex + 2} has ${row.length} values but the header has ` +
          `${columns.length} columns.`,
      );
    }

    return row.map((cell, columnIndex) => {
      if (columnIndex === 0) return cell;

      const text = String(cell ?? '').trim();
      if (text === '') return 0;

      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new InvalidCsvError(
          `Row ${rowIndex + 2}, column "${columns[columnIndex] ?? columnIndex}" ` +
            `is "${cell}", which is not a number.`,
        );
      }
      return value;
    });
  });
}
