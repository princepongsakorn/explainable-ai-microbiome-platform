import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { Prediction } from './prediction.entity';
import { PredictionStatus } from 'src/interface/prediction-class.enum';
@Entity()
export class PredictionRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  record_number: number;

  @ManyToOne(() => Prediction, (prediction) => prediction.id)
  prediction: Prediction;

  @Column('jsonb')
  dfData: number[];

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  proba?: number;

  @Column({ nullable: true })
  class?: number;

  @Column({ type: 'text', nullable: true })
  waterfall?: string | null;

  // Set when `waterfall` could not be produced — stores an ImageGenStatus
  // code (IMAGE_FAILED / UPLOAD_FAILED). null when the waterfall is fine.
  @Column({ type: 'text', nullable: true })
  waterfallError?: string | null;

  @Column({ nullable: true })
  barPlot?: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'enum', enum: PredictionStatus, default: PredictionStatus.PENDING })
  status: PredictionStatus;

  @Column({ type: 'text', nullable: true })
  errorMsg?: string | null;

  @Column({ type: 'text', nullable: true })
  comment?: string;
}