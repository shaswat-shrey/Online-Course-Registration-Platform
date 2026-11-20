import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export function initials(first?: string, last?: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';
}

export function UserAvatar({
  firstName,
  lastName,
  url,
  className,
}: {
  firstName: string;
  lastName: string;
  url?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn('size-9', className)}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback className="bg-primary text-primary-foreground">
        {initials(firstName, lastName)}
      </AvatarFallback>
    </Avatar>
  );
}
