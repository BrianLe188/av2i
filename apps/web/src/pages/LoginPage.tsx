import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { api, type AuthConfig } from '../api';
import { useAuth } from '../auth';

const ERRORS: Record<string, string> = {
  github_not_configured: 'GitHub sign-in is not configured on the server yet.',
  state_mismatch: 'The sign-in attempt expired or was tampered with. Please try again.',
  github_failed: 'GitHub did not accept the sign-in. Please try again.',
};

export function LoginPage() {
  const { user, setUser } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState(ERRORS[params.get('error') ?? ''] ?? '');

  useEffect(() => {
    api.authConfig().then(setConfig).catch(() => setError('Cannot reach the server.'));
  }, []);

  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  return (
    <div className="page-center">
      <div className="login-card">
        <h1>av2i</h1>
        <p className="muted">Design AWS infrastructure on a canvas. Get Terraform out.</p>
        {error && <div className="banner error">{error}</div>}
        {/* A real navigation, not fetch: the server redirects on to github.com. */}
        <a className="btn primary" href="/api/auth/github">
          Continue with GitHub
        </a>
        {config && !config.github && (
          <p className="muted">
            GitHub OAuth is not configured: set <code>GITHUB_CLIENT_ID</code> and{' '}
            <code>GITHUB_CLIENT_SECRET</code> in <code>apps/api/.env</code>.
          </p>
        )}
        {config?.devLogin && (
          <button
            onClick={() =>
              api
                .devLogin()
                .then(setUser)
                .catch((e) => setError(e.message))
            }
          >
            Continue as dev user
          </button>
        )}
      </div>
    </div>
  );
}
