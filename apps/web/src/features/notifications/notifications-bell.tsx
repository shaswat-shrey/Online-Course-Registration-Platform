import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { apiGet, apiGetPage, apiPost } from '@/services/http';
import { formatRelative } from '@/utils/format';

interface Notice {
  id: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Unread badge and recent notifications (FR-NOTIF-001..003); pushes arrive through the realtime bridge. */
export function NotificationsBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const count = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => apiGet<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 300_000,
  });
  const list = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => apiGetPage<Notice>('/notifications', { params: { limit: 8 } }),
    enabled: open,
  });
  const mark = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => apiPost('/notifications/read', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = count.data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => mark.mutate({ all: true })}
            >
              Mark all read
            </Button>
          )}
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {list.isPending && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
          {list.data && list.data.data.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">You’re all caught up.</li>
          )}
          {list.data?.data.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={cn(
                  'block w-full border-b px-3 py-2 text-left hover:bg-accent',
                  !n.readAt && 'bg-brand/5',
                )}
                onClick={() => {
                  if (!n.readAt) mark.mutate({ ids: [n.id] });
                  setOpen(false);
                  if (n.link) navigate(n.link);
                }}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className={cn('text-sm', !n.readAt && 'font-medium')}>{n.title}</span>
                  {!n.readAt && (
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-brand"
                      aria-label="Unread"
                    />
                  )}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                  {n.body}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {formatRelative(n.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
