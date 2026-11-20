import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useId, useState, type ComponentProps, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps extends ComponentProps<typeof Input> {
  label: string;
  error?: string;
  hint?: ReactNode;
  labelAction?: ReactNode;
}

/** Labelled input with accessible error/hint wiring (aria-invalid, aria-describedby). */
export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, error, hint, labelAction, id, className, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const describedBy = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={inputId}>{label}</Label>
        {labelAction}
      </div>
      <Input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...props}
      />
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
});

export const PasswordField = forwardRef<HTMLInputElement, Omit<FieldProps, 'type'>>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <TextField
          ref={ref}
          type={visible ? 'text' : 'password'}
          {...props}
          className={cn('[&_input]:pr-10', props.className)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-[1.85rem] rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  },
);
