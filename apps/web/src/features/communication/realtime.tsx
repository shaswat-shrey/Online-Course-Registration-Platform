import { useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import type { Portal } from '@ucrams/shared';
import { Button } from '@/components/ui/button';
import { API_BASE_URL, refreshOnce } from '@/services/http';
import { useAuthStore, useCan } from '@/store/auth-store';
import { useUnreadMessages } from './api/queries';

interface PushedNotification {
  category: string;
  title: string;
  body: string;
  link: string | null;
}

/** Origin of the API when it is served elsewhere; same origin (via the dev proxy) otherwise. */
const socketOrigin = /^https?:\/\//.test(API_BASE_URL) ? new URL(API_BASE_URL).origin : undefined;

/**
 * Keeps one Socket.IO connection per signed-in tab (FR-COMM-001, FR-NOTIF-002)
 * and turns pushed events into cache invalidations, so lists, badges and open
 * threads update without polling.
 */
export function RealtimeBridge() {
  const signedIn = useAuthStore((s) => !!s.accessToken);
  const qc = useQueryClient();
  useEffect(() => {
    if (!signedIn || import.meta.env.MODE === 'test') return;
    const socket = io(socketOrigin ?? '', {
      path: '/socket.io',
      transports: ['websocket'],
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
    });
    socket.on('connect_error', (err: Error & { data?: { code?: string } }) => {
      // Middleware rejections do not retry on their own: refresh, then reconnect.
      if (err.data?.code === 'TOKEN_EXPIRED' || err.data?.code === 'UNAUTHENTICATED')
        refreshOnce()
          .then(() => socket.connect())
          .catch(() => undefined);
    });
    socket.on('notification:new', (n: PushedNotification) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      if (n.category === 'ANNOUNCEMENT') void qc.invalidateQueries({ queryKey: ['announcements'] });
      if (n.category === 'TICKET') void qc.invalidateQueries({ queryKey: ['tickets'] });
      if (n.category === 'FEEDBACK') void qc.invalidateQueries({ queryKey: ['feedback'] });
      toast(n.title, { description: n.body.slice(0, 140) });
    });
    const refreshConversation = ({ conversationId }: { conversationId: string }) => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['messages', conversationId] });
    };
    socket.on('message:new', refreshConversation);
    socket.on('message:updated', refreshConversation);
    socket.on('message:deleted', refreshConversation);
    socket.on(
      'conversation:read',
      () => void qc.invalidateQueries({ queryKey: ['conversations'] }),
    );
    return () => {
      socket.disconnect();
    };
  }, [signedIn, qc]);
  return null;
}

/** Header shortcut to Messages with the unread count (FR-COMM-005). */
export function MessagesButton({ portal }: { portal: Portal }) {
  const allowed = useCan('message:send');
  const unread = useUnreadMessages(allowed).data?.total ?? 0;
  if (!allowed) return null;
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative"
      aria-label={unread ? `Messages, ${unread} unread` : 'Messages'}
    >
      <Link to={`/${portal}/messages`}>
        <MessagesSquare className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] leading-4 font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}
