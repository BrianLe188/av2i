import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { api, type AuthConfig } from '../api';
import { useAuth } from '../auth';
import { LogIn } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
    <div className="grid min-h-full place-items-center p-6">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-2xl">av2i</CardTitle>
          <CardDescription>Design AWS infrastructure on a canvas. Get Terraform out.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {/* A real navigation, not fetch: the server redirects on to github.com. */}
          <Button asChild size="lg">
            <a href="/api/auth/github">
              <LogIn /> Continue with GitHub
            </a>
          </Button>
          {config && !config.github && (
            <p className="text-xs text-muted-foreground">
              GitHub OAuth is not configured: set <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> in{' '}
              <code>apps/api/.env</code>.
            </p>
          )}
          {config?.devLogin && (
            <Button
              variant="outline"
              onClick={() =>
                api
                  .devLogin()
                  .then(setUser)
                  .catch((e) => setError(e.message))
              }
            >
              Continue as dev user
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
