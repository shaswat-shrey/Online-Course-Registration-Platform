import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormAlert } from '@/components/forms/form-alert';
import { FormDialog } from '@/components/forms/form-dialog';
import { PasswordField } from '@/components/forms/form-field';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi } from '@/features/auth/api/auth-api';
import { authErrorMessage } from '@/features/auth/api/auth-errors';

const statusKey = ['account', 'mfa'] as const;

function CodeInput({
  id,
  value,
  onChange,
  label = 'Code from your app',
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="one-time-code"
        maxLength={12}
        className="w-40 text-center font-mono tracking-widest"
      />
    </div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  return (
    <div className="space-y-3 rounded-md border border-warning/50 bg-warning/10 p-4">
      <p className="text-sm font-medium">Save these recovery codes now</p>
      <p className="text-sm text-muted-foreground">
        Each code works once if you lose your phone. They will not be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => toast.success('Codes copied'))
              .catch(() => toast.error('Copy failed — select and copy them instead'))
          }
        >
          <Copy className="size-4" /> Copy
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ucrams-recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="size-4" /> Download
        </Button>
        <Button size="sm" onClick={onDone}>
          I have saved them
        </Button>
      </div>
    </div>
  );
}

function Enrolment({ onCodes }: { onCodes: (codes: string[]) => void }) {
  const qc = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const setup = useMutation({ mutationFn: authApi.mfaSetup });
  const enable = useMutation({
    mutationFn: () => authApi.mfaEnable(code.trim()),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: statusKey });
      onCodes(r.recoveryCodes);
    },
    onError: () => setCode(''),
  });
  useEffect(() => {
    if (setup.data)
      QRCode.toDataURL(setup.data.otpauthUrl, { margin: 1, width: 192 })
        .then(setQr)
        .catch(() => setQr(null));
  }, [setup.data]);

  if (!setup.data)
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Add a second step to sign-in with an authenticator app such as Google Authenticator,
          Microsoft Authenticator or 1Password.
        </p>
        {setup.isError && <FormAlert>{authErrorMessage(setup.error)}</FormAlert>}
        <Button onClick={() => setup.mutate()} disabled={setup.isPending}>
          {setup.isPending && <Loader2 className="size-4 animate-spin" />}
          <ShieldCheck className="size-4" /> Turn on two-factor sign-in
        </Button>
      </div>
    );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (/^\d{6}$/.test(code.trim())) enable.mutate();
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Scan this code with your authenticator app.</li>
        <li>Enter the 6-digit code it shows to confirm.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {qr ? (
          <img
            src={qr}
            alt="QR code for your authenticator app"
            className="size-48 rounded-md border bg-white p-1"
          />
        ) : (
          <div className="size-48 animate-pulse rounded-md bg-muted" />
        )}
        <div className="min-w-0 space-y-1 text-sm">
          <p className="text-muted-foreground">Can't scan? Enter this key instead:</p>
          <p className="font-mono text-xs break-all" aria-label="Setup key">
            {setup.data.secret.replace(/(.{4})/g, '$1 ').trim()}
          </p>
        </div>
      </div>
      {enable.isError && <FormAlert>{authErrorMessage(enable.error)}</FormAlert>}
      <div className="flex flex-wrap items-end gap-3">
        <CodeInput id="mfa-enable-code" value={code} onChange={setCode} />
        <Button type="submit" disabled={enable.isPending || !/^\d{6}$/.test(code.trim())}>
          {enable.isPending && <Loader2 className="size-4 animate-spin" />} Confirm
        </Button>
      </div>
    </form>
  );
}

/** Two-factor sign-in: enrol with an authenticator app, recovery codes, turn off (SECURITY.md A07). */
export function TwoFactorCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: statusKey, queryFn: authApi.mfaStatus });
  const [codes, setCodes] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<'off' | 'codes' | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const disable = useMutation({
    mutationFn: () => authApi.mfaDisable(password, code.trim()),
    onSuccess: () => {
      toast.success('Two-factor sign-in is off');
      setDialog(null);
      void qc.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e) => setError(authErrorMessage(e)),
  });
  const regenerate = useMutation({
    mutationFn: () => authApi.mfaRecoveryCodes(code.trim()),
    onSuccess: (r) => {
      setDialog(null);
      setCodes(r.recoveryCodes);
      void qc.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e) => setError(authErrorMessage(e)),
  });
  const open = (d: 'off' | 'codes') => {
    setPassword('');
    setCode('');
    setError(null);
    setDialog(d);
  };
  const s = status.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Two-factor sign-in
          {s && (
            <StatusBadge tone={s.enabled ? 'success' : 'neutral'}>
              {s.enabled ? 'On' : 'Off'}
            </StatusBadge>
          )}
        </CardTitle>
        <CardDescription>
          A code from your phone is needed at sign-in, in addition to your password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {codes ? (
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        ) : !s ? (
          <Loader2 className="size-4 animate-spin" aria-label="Loading" />
        ) : !s.enabled ? (
          <Enrolment onCodes={setCodes} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              {s.recoveryCodesRemaining} recovery code{s.recoveryCodesRemaining === 1 ? '' : 's'}{' '}
              left.
            </p>
            <Button variant="outline" size="sm" onClick={() => open('codes')}>
              <KeyRound className="size-4" /> New recovery codes
            </Button>
            <Button variant="outline" size="sm" onClick={() => open('off')}>
              Turn off
            </Button>
          </div>
        )}
      </CardContent>
      <FormDialog
        open={dialog === 'off'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Turn off two-factor sign-in?"
        description="Your account will be protected by your password alone."
        submitLabel="Turn off"
        submitting={disable.isPending}
        error={error}
        onSubmit={() => disable.mutate()}
      >
        <PasswordField
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <CodeInput
          id="mfa-off-code"
          value={code}
          onChange={setCode}
          label="Code from your app or a recovery code"
        />
      </FormDialog>
      <FormDialog
        open={dialog === 'codes'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Replace recovery codes"
        description="Your old recovery codes stop working."
        submitLabel="Create new codes"
        submitting={regenerate.isPending}
        error={error}
        onSubmit={() => regenerate.mutate()}
      >
        <CodeInput id="mfa-codes-code" value={code} onChange={setCode} />
      </FormDialog>
    </Card>
  );
}
