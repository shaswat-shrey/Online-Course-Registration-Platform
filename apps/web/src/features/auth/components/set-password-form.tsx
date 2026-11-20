import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, passwordSchema } from '@ucrams/shared';
import { FormAlert } from '@/components/forms/form-alert';
import { PasswordField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/services/api-error';
import { authErrorMessage } from '../api/auth-errors';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
type Values = z.infer<typeof schema>;

interface Props {
  token: string | null;
  title: string;
  description: string;
  submitLabel: string;
  successTitle: string;
  submit: (input: { token: string; password: string }) => Promise<unknown>;
}

/** Shared by password reset and invitation acceptance. */
export function SetPasswordForm({
  token,
  title,
  description,
  submitLabel,
  successTitle,
  submit,
}: Props) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });
  const mutation = useMutation({
    mutationFn: (v: Values) => submit({ token: token!, password: v.password }),
  });

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Link not valid</h1>
        <FormAlert>
          This link is incomplete. Open the link from your email again, or request a new one.
        </FormAlert>
        <Button asChild variant="outline" className="w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (mutation.isSuccess) {
    return (
      <div className="space-y-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{successTitle}</h1>
          <p className="text-sm text-muted-foreground" role="status">
            You can now sign in with your new password.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  // Server-side policy violations (common password, contains email) map onto the field.
  const serverFieldError =
    isApiError(mutation.error) &&
    mutation.error.code === 'VALIDATION_ERROR' &&
    mutation.error.status === 422
      ? mutation.error.message
      : undefined;
  const linkExpired = serverFieldError?.includes('invalid or has expired');

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {mutation.isError && (linkExpired || !serverFieldError) && (
        <FormAlert>
          {authErrorMessage(mutation.error)}{' '}
          {linkExpired && (
            <Link to="/forgot-password" className="font-medium underline">
              Request a new link
            </Link>
          )}
        </FormAlert>
      )}
      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
      >
        <PasswordField
          label="New password"
          autoComplete="new-password"
          autoFocus
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Avoid common passwords and your email address.`}
          error={
            form.formState.errors.password?.message ?? (linkExpired ? undefined : serverFieldError)
          }
          {...form.register('password')}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          error={form.formState.errors.confirm?.message}
          {...form.register('confirm')}
        />
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
      </form>
    </div>
  );
}
