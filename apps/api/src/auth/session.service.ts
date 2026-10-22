import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { authConfig } from './config';

export const SESSION_COOKIE = 'av2i_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Stateless signed session: `<base64url payload>.<hmac>`. Payload is `{ sub, exp }`. */
@Injectable()
export class SessionService {
  private sign(data: string) {
    return createHmac('sha256', authConfig.sessionSecret()).update(data).digest('base64url');
  }

  issue(res: Response, userId: string) {
    const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + SESSION_TTL_MS })).toString(
      'base64url',
    );
    res.cookie(SESSION_COOKIE, `${payload}.${this.sign(payload)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: authConfig.isProd(),
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }

  clear(res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** The signed-in user's id, or null when the cookie is missing, forged or expired. */
  userIdFrom(req: Request): string | null {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return typeof sub === 'string' && typeof exp === 'number' && exp > Date.now() ? sub : null;
    } catch {
      return null;
    }
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
