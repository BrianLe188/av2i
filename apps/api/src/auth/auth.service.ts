import { BadGatewayException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { authConfig } from './config';
import { User } from './user.entity';

interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
  ) {}

  authorizeUrl(state: string) {
    const params = new URLSearchParams({
      client_id: authConfig.clientId(),
      redirect_uri: authConfig.callbackUrl(),
      scope: 'read:user',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  /** Trade the OAuth code for the user's GitHub profile, and create/update our user. */
  async signInWithGithub(code: string): Promise<User> {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: authConfig.clientId(),
        client_secret: authConfig.clientSecret(),
        code,
        redirect_uri: authConfig.callbackUrl(),
      }),
    });
    const token = (await tokenRes.json().catch(() => null)) as { access_token?: string; error?: string } | null;
    if (!tokenRes.ok || !token?.access_token) {
      throw new BadGatewayException(`GitHub token exchange failed${token?.error ? `: ${token.error}` : ''}`);
    }
    const profileRes = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${token.access_token}`, 'user-agent': 'av2i', accept: 'application/vnd.github+json' },
    });
    if (!profileRes.ok) throw new BadGatewayException('Could not read the GitHub profile');
    const profile = (await profileRes.json()) as GithubProfile;
    return this.upsert({
      githubId: String(profile.id),
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatar_url,
    });
  }

  devUser() {
    return this.upsert({ githubId: 'dev', login: 'dev-user', name: 'Dev User', avatarUrl: null });
  }

  private async upsert(data: Pick<User, 'githubId' | 'login' | 'name' | 'avatarUrl'>): Promise<User> {
    const existing = await this.users.findOneBy({ githubId: data.githubId });
    if (existing) return this.users.save({ ...existing, ...data });
    const isFirst = (await this.users.count()) === 0;
    const user = await this.users.save(this.users.create(data));
    // Projects made before auth existed have no owner: the first account to sign in inherits them.
    if (isFirst) await this.projects.createQueryBuilder().update().set({ ownerId: user.id }).where('ownerId IS NULL').execute();
    return user;
  }
}
