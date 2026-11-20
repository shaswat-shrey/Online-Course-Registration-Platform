import { useId, type ReactNode } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { TextField } from './form-field';

export interface Option {
  value: string;
  label: string;
}

/** Empty option value: Radix Select can't use '' so a sentinel maps to null/''. */
const NONE = '__none__';

function FieldShell({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  placeholder = 'Select…',
  allowEmpty,
  emptyLabel = 'None',
  hint,
  disabled,
  className,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: Option[];
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldShell
          id={id}
          label={label}
          error={fieldState.error?.message}
          hint={hint}
          className={className}
        >
          <Select
            value={field.value ? String(field.value) : allowEmpty ? NONE : ''}
            onValueChange={(v) => field.onChange(v === NONE ? null : v)}
            disabled={disabled}
          >
            <SelectTrigger
              id={id}
              aria-invalid={fieldState.error ? true : undefined}
              className="w-full"
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {allowEmpty && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  rows = 3,
  hint,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  rows?: number;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldShell id={id} label={label} error={fieldState.error?.message} hint={hint}>
          <Textarea
            id={id}
            rows={rows}
            {...field}
            value={field.value ?? ''}
            aria-invalid={fieldState.error ? true : undefined}
          />
        </FieldShell>
      )}
    />
  );
}

/** Number input bound to a numeric form value (empty → null). */
export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  step = 'any',
  min,
  hint,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  step?: string;
  min?: number;
  hint?: ReactNode;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          hint={hint}
          error={fieldState.error?.message}
          name={field.name}
          ref={field.ref}
          onBlur={field.onBlur}
          value={field.value ?? ''}
          onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  description,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor={id}>{label}</Label>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  );
}
