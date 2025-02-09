import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Prediction } from './prediction.entity';

@Entity()
export class PredictionRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Prediction, (prediction) => prediction.id)
  prediction: Prediction;

  @Column('jsonb')
  dfData: number[];

  @Column({ nullable: true })
  proba?: number;

  @Column({ nullable: true })
  class?: number;

  @Column({ nullable: true })
  waterfall?: string;
}