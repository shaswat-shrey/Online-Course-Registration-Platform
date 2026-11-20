import { Info } from 'lucide-react';
import { usePublicSettings } from '../api/platform-queries';

/** The administrator-set notice shown to every signed-in user (portal.bannerMessage). */
export function PortalBanner() {
  const { data } = usePublicSettings();
  const message = data?.['portal.bannerMessage'];
  if (!message) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm"
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0">{message}</p>
    </div>
  );
}
