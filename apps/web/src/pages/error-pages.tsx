import { Compass, ShieldX, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';

function ErrorLayout({
  icon,
  code,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  code: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center py-16 text-center">
      <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
        {icon}
      </span>
      <p className="text-sm font-semibold text-brand">{code}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted-foreground">{description}</p>
      <div className="mt-6 flex gap-3">
        <Button asChild>
          <Link to="/">Go to home</Link>
        </Button>
        {children}
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <ErrorLayout
      icon={<Compass className="size-7" aria-hidden />}
      code="404"
      title="Page not found"
      description="The page you are looking for does not exist or has moved."
    />
  );
}

export function ForbiddenPage() {
  return (
    <ErrorLayout
      icon={<ShieldX className="size-7" aria-hidden />}
      code="403"
      title="Access denied"
      description="You do not have permission to view this page. Contact your administrator if you think this is a mistake."
    />
  );
}

/** Router-level error boundary: renders for loader/render errors in any route. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  return (
    <div className="flex min-h-dvh flex-col">
      <ErrorLayout
        icon={<TriangleAlert className="size-7" aria-hidden />}
        code="Error"
        title="Something went wrong"
        description="An unexpected error occurred while displaying this page."
      >
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </ErrorLayout>
    </div>
  );
}
