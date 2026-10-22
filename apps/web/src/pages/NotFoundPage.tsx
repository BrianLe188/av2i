import { Link } from 'react-router-dom';

export function NotFoundPage({ what = 'page' }: { what?: string }) {
  return (
    <div className="page-center">
      <div className="login-card">
        <h1>Not found</h1>
        <p className="muted">This {what} doesn't exist, or isn't yours.</p>
        <Link className="btn" to="/">
          Back to projects
        </Link>
      </div>
    </div>
  );
}
