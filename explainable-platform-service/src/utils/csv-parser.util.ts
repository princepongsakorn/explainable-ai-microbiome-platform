import { Multer } from 'multer';
import { Readable } from 'stream';
import Papa from 'papaparse';

export async function parseCsv(
  file: Multer.File,
): Promise<{ dfColumns: string[]; dfDataRows: any[][] }> {
  return new Promise((resolve) => {
    const stream = Readable.from(file.buffer);
    Papa.parse(stream, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const csvData = result?.data;
        resolve({ dfColumns: csvData[0], dfDataRows: csvData.slice(1) });
      },
    });
  });
}
