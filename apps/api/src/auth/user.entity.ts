import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** GitHub's numeric user id (stable, unlike the login). Stored as text so it fits any driver. */
  @Column({ unique: true })
  githubId: string;

  @Column()
  login: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
