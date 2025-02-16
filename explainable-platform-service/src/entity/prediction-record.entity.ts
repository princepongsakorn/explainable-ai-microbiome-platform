import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { Prediction } from './prediction.entity';

export enum PredictionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}
@Entity()
export class PredictionRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Prediction, (prediction) => prediction.id)
  prediction: Prediction;

  @Column('jsonb')
  dfData: number[];

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  proba?: number;

  @Column({ nullable: true })
  class?: number;

  @Column({ nullable: true })
  waterfall?: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'enum', enum: PredictionStatus, default: PredictionStatus.PENDING })
  status: PredictionStatus;
}