import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  BeforeInsert,
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
  dfColumns: string[]
  
  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0.5 })
  threshold: number;

  @Column({ nullable: true })
  heatmap: string;

  @Column({ nullable: true })
  beeswarm: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}