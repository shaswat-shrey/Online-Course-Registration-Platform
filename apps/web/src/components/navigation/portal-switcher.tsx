import { ArrowLeftRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { Portal } from '@ucrams/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PORTAL_HOME, useAuthStore } from '@/store/auth-store';
import { PORTAL_LABEL } from './nav-config';

/** Shown only to users with more than one portal (e.g. faculty who are also department admins). */
export function PortalSwitcher({ portal }: { portal: Portal }) {
  const portals = useAuthStore((s) => s.me?.portals ?? []);
  const navigate = useNavigate();
  if (portals.length < 2) return null;
  return (
    <Select value={portal} onValueChange={(p) => navigate(PORTAL_HOME[p as Portal])}>
      <SelectTrigger className="h-8 w-auto gap-2 text-xs" aria-label="Switch portal">
        <ArrowLeftRight className="size-3.5" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {portals.map((p) => (
          <SelectItem key={p} value={p}>
            {PORTAL_LABEL[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
