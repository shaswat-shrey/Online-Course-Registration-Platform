import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { loginSchema, type LoginInput } from '@ucrams/shared';
import { FormAlert } from '@/components/forms/form-alert';
import { PasswordField, TextField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { homePath, useAuthStore } from '@/store/auth-store';
import { safeNext } from '@/utils/safe-next';
import { authApi } from '../api/auth-api';
import { authErrorMessage } from '../api/auth-errors';

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((s) => s.setSession);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: (result) => {
      queryClient.clear();
      setSession(result.accessToken, result.me);
      const next = safeNext(params.get('next'));
      navigate(next ?? homePath(result.me), { replace: true });
    },
    onError: () => form.resetField('password'),
  });

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
