/**
 * Add sample_labels to Explanation payloads that were built before labels existed.
 *
 * Only the two label fields are added. SHAP values are not recomputed, so this
 * costs no inference time and cannot change a single number in the payload.
 * Records are joined to Samples by UUID (sample_ids), never by position.
 *
 * Deliberately not built on AppModule: that registers the Bull queue processors,
 * so running it would start consuming prediction jobs, and it enables
 * `synchronize`, which a maintenance script must never do. This module loads
 * only the two entities and storage it needs, with synchronize off.
 *
 * Usage, from the service root after `npm run build`:
 *   node dist/scripts/backfill-sample-labels.js --dry-run
 *   node dist/scripts/backfill-sample-labels.js
 *
 * Safe to run more than once: a payload that already has labels is skipped. The
 * original file is kept beside the rewritten one as explain.pre-labels.json.gz.
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { IsNull, Not, Repository } from 'typeorm';
import { Prediction } from '../entity/prediction.entity';
import { PredictionRecord } from '../entity/prediction-record.entity';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  ExplainPayload,
  backfillSampleLabels,
} from '../predictions/explain.builder';

@Module({
  imports: [
    // Must come first: it loads .env, which the TypeORM options below read.
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Prediction, PredictionRecord],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([Prediction, PredictionRecord]),
    StorageModule,
  ],
})
class BackfillModule {}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error'],
  });

  const predictions = app.get<Repository<Prediction>>(getRepositoryToken(Prediction));
  const records = app.get<Repository<PredictionRecord>>(
    getRepositoryToken(PredictionRecord),
  );
  const storage = app.get(StorageService);

  const candidates = await predictions.find({
    where: { explainKey: Not(IsNull()) },
    select: ['id', 'prediction_number', 'dfColumns', 'explainKey', 'explainEtag'],
    order: { prediction_number: 'ASC' },
  });

  const tally = { updated: 0, skipped: 0, failed: 0 };
  for (const prediction of candidates) {
    const tag = `#${prediction.prediction_number}`;
    try {
      const original = await storage.download(prediction.explainKey!);
      const payload = JSON.parse(gunzipSync(original).toString('utf8')) as ExplainPayload;
      const rows = await records.find({
        where: { prediction: { id: prediction.id } },
        select: ['id', 'record_number', 'dfData'],
      });

      const result = backfillSampleLabels(payload, rows, prediction.dfColumns ?? []);
      if (result.status === 'skipped') {
        tally.skipped++;
        console.log(`skip          ${tag}: ${result.reason}`);
        continue;
      }

      const labels = result.payload.sample_labels ?? [];
      const column = result.payload.sample_label_column;
      const example = `${column ? `${column}: ` : ''}${labels.slice(0, 2).join(', ')}`;
      if (dryRun) {
        tally.updated++;
        console.log(`would update  ${tag}: ${labels.length} labels, e.g. ${example}`);
        continue;
      }

      // Keep the original beside the rewritten file before touching it.
      await storage.uploadJsonGzip(original, prediction.id, 'explain.pre-labels.json.gz');

      // Same serialisation and hash as PredictionProcessor.buildExplanation, so the
      // ETag means the same thing whichever path wrote the file. A new ETag is what
      // makes a browser holding the old one fetch the labelled payload.
      const raw = Buffer.from(JSON.stringify(result.payload), 'utf8');
      const etag = createHash('sha256').update(raw).digest('hex');
      const key = await storage.uploadJsonGzip(gzipSync(raw), prediction.id, 'explain.json.gz');
      await predictions.update({ id: prediction.id }, { explainKey: key, explainEtag: etag });

      tally.updated++;
      console.log(`updated       ${tag}: ${labels.length} labels, e.g. ${example}`);
    } catch (error) {
      tally.failed++;
      console.error(`failed        ${tag}: ${(error as Error).message}`);
    }
  }

  console.log(
    `${dryRun ? 'dry run — ' : ''}${tally.updated} ${dryRun ? 'would be updated' : 'updated'}, ` +
      `${tally.skipped} skipped, ${tally.failed} failed, of ${candidates.length}`,
  );
  await app.close();
  if (tally.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
