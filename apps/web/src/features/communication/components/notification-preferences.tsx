import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/services/api-error';
import { useDigest, usePreferences, useSaveDigest, useSavePreference } from '../api/queries';
import { CATEGORY_NOTIFICATION_LABEL } from '../api/types';

const CHANNEL_LABEL = { IN_APP: 'In the portal', EMAIL: 'Email' } as const;

/** Notification channels per category (FR-NOTIF-004); mandatory channels are shown locked. */
export function NotificationPreferencesCard() {
  const prefs = usePreferences();
  const save = useSavePreference();
  const digest = useDigest();
  const saveDigest = useSaveDigest();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notifications</CardTitle>
        <CardDescription>
          Choose where you hear about each kind of update. Registration and waitlist notices are
          always sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <Switch
            checked={digest.data?.enabled ?? false}
            disabled={!digest.data || saveDigest.isPending}
            onCheckedChange={(enabled) =>
              saveDigest.mutate(enabled, {
                onSuccess: () =>
                  toast.success(enabled ? 'Daily summary on' : 'Emails will arrive as they happen'),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          />
          <span>
            <span className="font-medium">Daily email summary</span>
            <span className="block text-muted-foreground">
              Collect emails into one message a day. Registration, waitlist and urgent notices still
              arrive straight away.
            </span>
          </span>
        </label>
        {prefs.isPending ? (
          <LoadingRows rows={4} />
        ) : prefs.isError ? (
          <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Notification channels by category</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 font-medium">
                  Category
                </th>
                {(['IN_APP', 'EMAIL'] as const).map((c) => (
                  <th key={c} scope="col" className="w-28 py-2 text-center font-medium">
                    {CHANNEL_LABEL[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prefs.data.map((row) => (
                <tr key={row.category} className="border-b last:border-0">
                  <th scope="row" className="py-2.5 text-left font-normal">
                    {CATEGORY_NOTIFICATION_LABEL[row.category]}
                  </th>
                  {row.channels.map((c) => {
                    const label = `${CATEGORY_NOTIFICATION_LABEL[row.category]}: ${CHANNEL_LABEL[c.channel]}`;
                    return (
                      <td key={c.channel} className="py-2.5 text-center">
                        <span className="inline-flex items-center gap-1.5">
                          <Switch
                            checked={c.enabled}
                            disabled={c.mandatory || save.isPending}
                            aria-label={c.mandatory ? `${label} (always on)` : label}
                            onCheckedChange={(enabled) =>
                              save.mutate(
                                { category: row.category, channel: c.channel, enabled },
                                { onError: (e) => toast.error(errorMessage(e)) },
                              )
                            }
                          />
                          {c.mandatory && (
                            <Lock className="size-3.5 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
