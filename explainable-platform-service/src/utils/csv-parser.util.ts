import * as csv from 'csv-parser';

export async function parseCsv(csvData: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const results = [];
    csvData.split('\n').forEach((line) => {
      results.push(line.split(','));
    });
    resolve(results);
  });
}