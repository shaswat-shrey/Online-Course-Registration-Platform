import type { MailMessage } from './mailer.js';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function layout(
  title: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#1e2a4a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#555">If the button does not work, open this link: ${escapeHtml(action.url)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1f36;max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 20px">${escapeHtml(title)}</h1>${body}${button}
<p style="font-size:12px;color:#777;margin-top:32px">This is an automated message from the university course registration system.</p></body></html>`;
}

export function passwordResetEmail(
  to: string,
  firstName: string,
  url: string,
  minutes: number,
): MailMessage {
  const lines = [
    `Hello ${firstName},`,
    'We received a request to reset the password for your account.',
    `This link expires in ${minutes} minutes and can be used once. If you did not request a reset, you can ignore this email; your password will not change.`,
  ];
  return {
    to,
    subject: 'Reset your password',
    text: `${lines.join('\n\n')}\n\nReset your password: ${url}\n`,
    html: layout('Reset your password', lines, { label: 'Reset password', url }),
  };
}

export function invitationEmail(
  to: string,
  firstName: string,
  url: string,
  hours: number,
): MailMessage {
  const lines = [
    `Hello ${firstName},`,
    'An account has been created for you on the university course registration and academic management system.',
    `Set your password to activate it. This link expires in ${hours} hours.`,
  ];
  return {
    to,
    subject: 'Activate your account',
    text: `${lines.join('\n\n')}\n\nActivate your account: ${url}\n`,
    html: layout('Activate your account', lines, { label: 'Set password', url }),
  };
}

export function passwordChangedEmail(to: string, firstName: string): MailMessage {
  const lines = [
    `Hello ${firstName},`,
    'The password for your account was just changed and other signed-in devices were signed out.',
    'If you did not do this, reset your password immediately and contact the university IT help desk.',
  ];
  return {
    to,
    subject: 'Your password was changed',
    text: lines.join('\n\n'),
    html: layout('Password changed', lines),
  };
}
