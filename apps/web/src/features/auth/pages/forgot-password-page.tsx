import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@ucrams/shared';
import { FormAlert } from '@/components/forms/form-alert';
import { TextField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { authApi } from '../api/auth-api';
import { authErrorMessage } from '../api/auth-errors';

export function ForgotPasswordPage() {
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const request = useMutation({
    mutationFn: (v: ForgotPasswordInput) => authApi.forgotPassword(v.email),
  });

  if (request.isSuccess) {
    return (
      <div className="space-y-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-sm text-muted-foreground" role="status">
            {request.data.data.message}
          </p>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your account email and we will send you a reset link.
        </p>
      </div>
      {request.isError && <FormAlert>{authErrorMessage(request.error)}</FormAlert>}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => request.mutate(v))}>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Button type="submit" className="w-full" disabled={request.isPending}>
          {request.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Send reset link
        </Button>
      </form>
      <Link
        to="/login"
        className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to sign in
      </Link>
    </div>
  );
}
