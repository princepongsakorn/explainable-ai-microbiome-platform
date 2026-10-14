import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the model version a Prediction is pinned to, and the version that
 * answered for each record.
 *
 * The app itself runs with `synchronize: true` (app.module.ts), which adds
 * these columns on start; this migration is for a database managed through
 * data-source.ts instead. Both columns are nullable so Predictions made before
 * pinning still load, and `IF NOT EXISTS` lets it run after synchronize has.
 */
export class PinPredictionModelVersion1791972211000
  implements MigrationInterface
{
  name = 'PinPredictionModelVersion1791972211000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prediction" ADD COLUMN IF NOT EXISTS "modelVersion" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "prediction_record" ADD COLUMN IF NOT EXISTS "modelVersion" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prediction_record" DROP COLUMN IF EXISTS "modelVersion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prediction" DROP COLUMN IF EXISTS "modelVersion"`,
    );
  }
}
