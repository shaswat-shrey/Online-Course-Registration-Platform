import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { SettingKey } from '@ucrams/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/services/api-error';
import { useSettings, useUpdateSetting, type SettingRow } from '../api/platform-queries';

function SettingCard({ setting }: { setting: SettingRow }) {
  const save = useUpdateSetting();
  // The card is keyed by its last update, so the draft resets after a save.
  const [draft, setDraft] = useState(
    setting.value === null || setting.value === undefined ? '' : String(setting.value),
  );
  const id = `setting-${setting.key}`;
  const submit = (value: unknown) =>
    save.mutate(
      { key: setting.key as SettingKey, value },
      {
        onSuccess: () => toast.success('Setting saved'),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  const isBool = typeof setting.default === 'boolean';
  const isNumber = typeof setting.default === 'number';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <Label htmlFor={id}>{setting.label}</Label>
        </CardTitle>
        <CardDescription>{setting.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isBool ? (
          <Switch
            id={id}
            checked={Boolean(setting.value)}
            disabled={save.isPending}
            onCheckedChange={(v) => submit(v)}
          />
        ) : (
          <form
            className="flex flex-wrap items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(isNumber ? Number(draft) : draft);
            }}
          >
            {isNumber ? (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-32"
              />
            ) : (
              <Textarea
                id={id}
                value={draft}
                maxLength={300}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-16 flex-1 basis-80"
              />
            )}
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Save
            </Button>
          </form>
        )}
        <p className="text-xs text-muted-foreground">
          Default: {setting.default === null ? 'empty' : String(setting.default)}
          {setting.updatedAt && ` · last changed ${new Date(setting.updatedAt).toLocaleString()}`}
        </p>
      </CardContent>
    </Card>
  );
}

/** System settings (super administrators; every change is audited). */
export function SettingsPage() {
  const settings = useSettings();
  return (
    <>
      <PageHeader
        title="System settings"
        description="University-wide behaviour. Every change is recorded in the audit log."
      />
      {settings.isPending ? (
        <LoadingRows />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <div className="grid gap-4">
          {settings.data.map((s) => (
            <SettingCard key={`${s.key}:${s.updatedAt ?? ''}`} setting={s} />
          ))}
        </div>
      )}
    </>
  );
}
