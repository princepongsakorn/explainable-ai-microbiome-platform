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

  @Column()
  modelName: string;

  @Column('jsonb')
  dfColumns: string[]

  @Column({ nullable: true })
  heatmap: string;

  @Column({ nullable: true })
  beeswarm: string;

  @CreateDateColumn()
  createdAt: Date;
}
