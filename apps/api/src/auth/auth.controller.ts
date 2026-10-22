import { randomBytes } from 'node:crypto';
import { Controller, Get, HttpCode, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { authConfig } from './config';
import { CurrentUser, Public } from './decorators';
import { readCookie, SessionService } from './session.service';
import type { User } from './user.entity';

const STATE_COOKIE = 'av2i_oauth_state';

const publicUser = (u: User) => ({ id: u.id, login: u.login, name: u.name, avatarUrl: u.avatarUrl });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** What the login page can offer. */
  @Public()
  @Get('config')
  config() {
    return { github: authConfig.githubEnabled(), devLogin: authConfig.devLoginEnabled() };
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return publicUser(user);
  }

  @Public()
  @Get('github')
  github(@Res() res: Response) {
    if (!authConfig.githubEnabled()) {
      return res.redirect(`${authConfig.webUrl()}/login?error=github_not_configured`);
    }
    const state = randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: authConfig.isProd(),
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
    res.redirect(this.auth.authorizeUrl(state));
  }

  @Public()
  @Get('github/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const expected = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: '/' });
    const fail = (reason: string) => res.redirect(`${authConfig.webUrl()}/login?error=${reason}`);
    if (!code || !state || !expected || state !== expected) return fail('state_mismatch');
    try {
      const user = await this.auth.signInWithGithub(code);
      this.sessions.issue(res, user.id);
      res.redirect(`${authConfig.webUrl()}/`);
    } catch {
      fail('github_failed');
    }
  }

  @Public()
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(@Res({ passthrough: true }) res: Response) {
    if (!authConfig.devLoginEnabled()) throw new NotFoundException();
    const user = await this.auth.devUser();
    this.sessions.issue(res, user.id);
    return publicUser(user);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    this.sessions.clear(res);
  }
}
