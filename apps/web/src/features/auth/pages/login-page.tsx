import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { isMfaChallenge, loginSchema, type LoginInput, type LoginResultDto } from '@ucrams/shared';
import { FormAlert } from '@/components/forms/form-alert';
import { PasswordField, TextField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { homePath, useAuthStore } from '@/store/auth-store';
import { safeNext } from '@/utils/safe-next';
import { authApi } from '../api/auth-api';
import { authErrorMessage } from '../api/auth-errors';
import { isApiError } from '@/services/api-error';
import { ErrorCode } from '@ucrams/shared';

const isExpired = (e: unknown) => isApiError(e) && e.code === ErrorCode.MFA_CHALLENGE_EXPIRED;

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((s) => s.setSession);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const signedIn = (result: LoginResultDto) => {
    queryClient.clear();
    setSession(result.accessToken, result.me);
    const next = safeNext(params.get('next'));
    navigate(next ?? homePath(result.me), { replace: true });
  };
  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: (result) => {
      if (isMfaChallenge(result)) {
        setCode('');
        setChallenge(result.challengeToken);
      } else signedIn(result);
    },
    onError: () => form.resetField('password'),
  });
  const verify = useMutation({
    mutationFn: () => authApi.verifyMfa(challenge!, code.trim()),
    onSuccess: signedIn,
    onError: (e) => {
      setCode('');
      if (isExpired(e)) {
        setChallenge(null);
        form.resetField('password');
      }
    },
  });

  if (challenge)
    return (
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Two-factor sign-in</h1>
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app, or one of your recovery codes.
          </p>
        </div>
        {verify.isError && <FormAlert>{authErrorMessage(verify.error)}</FormAlert>}
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim().length >= 6) verify.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="mfa-code">Authentication code</Label>
            <Input
              id="mfa-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              maxLength={12}
              className="text-center font-mono text-lg tracking-widest"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={verify.isPending || code.trim().length < 6}
          >
            {verify.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Verify
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setChallenge(null);
              form.resetField('password');
            }}
          >
            Use a different account
          </Button>
        </form>
      </div>
    );

  const { errors } = form.formState;
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Use your university email address and password.
        </p>
      </div>
      {params.get('reason') === 'session-ended' && !login.isError && (
        <FormAlert>Your session ended. Please sign in again.</FormAlert>
      )}
      {login.isError && <FormAlert>{authErrorMessage(login.error)}</FormAlert>}
      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit((values) => login.mutate(values))}
      >
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          autoFocus
          error={errors.email?.message}
          {...form.register('email')}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          error={errors.password?.message}
          labelAction={
            <Link to="/forgot-password" className="text-xs font-medium text-brand hover:underline">
              Forgot password?
            </Link>
          }
          {...form.register('password')}
        />
        <div className="flex items-center gap-2">
          <Controller
            control={form.control}
            name="rememberMe"
            render={({ field }) => (
              <Checkbox
                id="rememberMe"
                checked={field.value}
                onCheckedChange={(v) => field.onChange(v === true)}
              />
            )}
          />
          <Label htmlFor="rememberMe" className="text-sm font-normal">
            Keep me signed in on this device
          </Label>
        </div>
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Sign in
        </Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        Accounts are created by the university. If you have not received an invitation, contact the
        administration office.
      </p>
    </div>
  );
}
