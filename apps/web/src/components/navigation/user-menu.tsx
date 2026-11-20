import { KeyRound, LogOut } from 'lucide-react';
import { Link } from 'react-router';
import type { Portal } from '@ucrams/shared';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignOut } from '@/features/auth/use-sign-out';
import { useAuthStore } from '@/store/auth-store';

export function initials(first?: string, last?: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';
}

export function UserMenu({ portal }: { portal: Portal }) {
  const me = useAuthStore((s) => s.me);
  const signOut = useSignOut();
  if (!me) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="Account menu">
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary text-xs text-primary-foreground">
              {initials(me.user.firstName, me.user.lastName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium md:inline">{me.user.firstName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium">
            {me.user.firstName} {me.user.lastName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={`/${portal}/account`}>
            <KeyRound className="size-4" /> Account security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
