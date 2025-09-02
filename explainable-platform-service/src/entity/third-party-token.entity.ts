import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class ThirdPartyToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  provider: string;

  @Column()
  token: string;

  @ManyToOne(() => User, (user) => user.thirdPartyTokens, {
    onDelete: 'CASCADE',
  })
  user: User;
}
