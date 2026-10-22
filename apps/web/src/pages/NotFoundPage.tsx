import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function NotFoundPage({ what = 'page' }: { what?: string }) {
  return (
    <div className="grid min-h-full place-items-center p-6">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-2xl">Not found</CardTitle>
          <CardDescription>This {what} doesn't exist, or isn't yours.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/">Back to projects</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
