import { StatusBadge, type StatusTone } from './status-badge';

const TONES: Record<string, { tone: StatusTone; label: string }> = {
  ACTIVE: { tone: 'success', label: 'Active' },
  INACTIVE: { tone: 'neutral', label: 'Inactive' },
  ARCHIVED: { tone: 'neutral', label: 'Archived' },
  PLANNED: { tone: 'info', label: 'Planned' },
  COMPLETED: { tone: 'neutral', label: 'Completed' },
};

export function EntityStatus({ status }: { status: string }) {
  const t = TONES[status] ?? { tone: 'neutral' as const, label: status };
  return <StatusBadge tone={t.tone}>{t.label}</StatusBadge>;
}

export const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'ARCHIVED', label: 'Archived' },
];
