import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class Prediction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  prediction_number: number;

  @Column()
  modelName: string;

  @Column('jsonb')
  dfColumns: string[];

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0.5 })
  threshold: number;

  @Column({ type: 'text', nullable: true })
  heatmap?: string | null;

  // Set when `heatmap` could not be produced — ImageGenStatus code, else null.
  @Column({ type: 'text', nullable: true })
  heatmapError?: string | null;

  @Column({ type: 'text', nullable: true })
  beeswarm?: string | null;

  // Set when `beeswarm` could not be produced — ImageGenStatus code, else null.
  @Column({ type: 'text', nullable: true })
  beeswarmError?: string | null;

  // --- Explanation payload (docs/shap-explain-spec.md 2.3) ---------------
  //
  // The heatmap/beeswarm columns above are deliberately retained. TypeORM runs
  // with `synchronize: true` (app.module.ts), so removing a property here drops
  // the column and its data without prompting — and the old PNGs are the visual
  // reference the new charts are checked against while they are being built.

  /** GCS object key for `explain.json.gz`, or null when it has not been built. */
  @Column({ type: 'text', nullable: true })
  explainKey?: string | null;

  /** SHA-256 of the uncompressed payload. Answers If-None-Match without touching GCS. */
  @Column({ type: 'text', nullable: true })
  explainEtag?: string | null;

  @Column({ type: 'text', nullable: true })
  explainError?: string | null;

  /** Which model version produced it, so a promotion can invalidate it. */
  @Column({ type: 'text', nullable: true })
  explainModelVersion?: string | null;

  @Column({ type: 'int', nullable: true })
  explainContractVersion?: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
