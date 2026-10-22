const isProd = () => process.env.NODE_ENV === 'production';

export const authConfig = {
  isProd,
  clientId: () => process.env.GITHUB_CLIENT_ID ?? '',
  clientSecret: () => process.env.GITHUB_CLIENT_SECRET ?? '',
  /** Where GitHub sends the browser back. Goes through the web dev server's /api proxy by default. */
  callbackUrl: () =>
    process.env.GITHUB_CALLBACK_URL ?? 'http://localhost:5173/api/auth/github/callback',
  webUrl: () => process.env.WEB_URL ?? 'http://localhost:5173',
  githubEnabled: () => Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  /** A one-click fake login for local review only; never honoured in production. */
  devLoginEnabled: () => process.env.DEV_LOGIN === 'true' && !isProd(),
  sessionSecret: () => {
    const secret = process.env.SESSION_SECRET;
    if (secret) return secret;
    if (isProd()) throw new Error('SESSION_SECRET is required in production');
    return 'dev-only-session-secret';
  },
};
