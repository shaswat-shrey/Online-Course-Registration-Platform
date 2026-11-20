import { useSearchParams } from 'react-router';
import { authApi } from '../api/auth-api';
import { SetPasswordForm } from '../components/set-password-form';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  return (
    <SetPasswordForm
      token={params.get('token')}
      title="Choose a new password"
      description="Signing in with the new password will be required on all your devices."
      submitLabel="Reset password"
      successTitle="Password reset"
      submit={authApi.resetPassword}
    />
  );
}

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  return (
    <SetPasswordForm
      token={params.get('token')}
      title="Activate your account"
      description="Set a password to finish setting up your account."
      submitLabel="Activate account"
      successTitle="Account activated"
      submit={authApi.acceptInvite}
    />
  );
}
