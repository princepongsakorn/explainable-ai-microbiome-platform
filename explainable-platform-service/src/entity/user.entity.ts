import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { ThirdPartyToken } from './third-party-token.entity';
import { UserRole } from 'src/interface/user.interface';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @OneToMany(() => ThirdPartyToken, (token) => token.user)
  thirdPartyTokens: ThirdPartyToken[];
}
