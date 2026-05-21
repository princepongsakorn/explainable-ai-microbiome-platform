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

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}