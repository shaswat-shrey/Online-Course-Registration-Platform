import { UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth-store';
import { useSignOut } from '../use-sign-out';

/** Signed in, but the account has no role that opens a portal yet. */
export function NoAccessPage() {
  const me = useAuthStore((s) => s.me);
  const signOut = useSignOut();
  return (
    <div className="space-y-6 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary">
        <UserX className="size-6" aria-hidden />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">No portal access yet</h1>
        <p className="text-sm text-muted-foreground">
          You are signed in as <strong>{me?.user.email}</strong>, but your account has not been
          given a role yet. Contact the administration office.
        </p>
      </div>
      <Button variant="outline" className="w-full" onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  );
}
