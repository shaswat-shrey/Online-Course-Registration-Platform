import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useFieldArray } from 'react-hook-form';
import { toast } from 'sonner';
import {
  academicSessionCreateSchema,
  academicYearCreateSchema,
  gradingScaleSchema,
  SESSION_TYPES,
} from '@ucrams/shared';
import { SelectField, TextareaField } from '@/components/forms/fields';
import { TextField } from '@/components/forms/form-field';
import { FormDialog } from '@/components/forms/form-dialog';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { STATUS_OPTIONS } from '@/components/shared/entity-status';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  SESSION_TYPE_LABEL,
  useGradingScales,
  useSaveScale,
  useSaveSession,
  useSaveYear,
  useYears,
  type AcademicSession,
  type AcademicYear,
  type GradingScale,
} from '../api/calendar-queries';

interface DialogProps<T> {
  entity?: T;
  trigger: (open: () => void) => ReactNode;
  onSaved?: (saved: { id: string }) => void;
}

export function YearDialog({ entity, trigger }: DialogProps<AcademicYear>) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveYear();
  const defaults = {
    label: entity?.label ?? '',
    startDate: entity?.startDate ?? '',
    endDate: entity?.endDate ?? '',
  };
  const form = useZodForm(academicYearCreateSchema, defaults);
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const e = form.formState.errors;
  return (
    <>
      {trigger(() => {
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={entity ? 'Edit academic year' : 'New academic year'}
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        onSubmit={form.handleSubmit((values) =>
          save.mutate(
            { id: entity?.id, ...values },
            {
              onSuccess: () => {
                toast.success('Academic year saved');
                setOpen(false);
              },
              onError: (err) =>
                setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
            },
          ),
        )}
      >
        <TextField
          label="Label"
          placeholder="2027-2028"
          error={e.label?.message}
          {...form.register('label')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Start date"
            type="date"
            error={e.startDate?.message}
            {...form.register('startDate')}
          />
          <TextField
            label="End date"
            type="date"
            error={e.endDate?.message}
            {...form.register('endDate')}
          />
        </div>
      </FormDialog>
    </>
  );
}

export function SessionDialog({ entity, trigger, onSaved }: DialogProps<AcademicSession>) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveSession();
  const years = useYears();
  const scales = useGradingScales();
  const defaults = {
    academicYearId: entity?.academicYear.id ?? '',
    code: entity?.code ?? '',
    name: entity?.name ?? '',
    type: (entity?.type ?? 'FALL') as 'FALL',
    startDate: entity?.startDate ?? '',
    endDate: entity?.endDate ?? '',
    gradingScaleId: entity?.gradingScale?.id ?? null,
  };
  const form = useZodForm(academicSessionCreateSchema, defaults);
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const e = form.formState.errors;
  return (
    <>
      {trigger(() => {
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={entity ? 'Edit session' : 'New session'}
        description="A term or semester within an academic year."
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        wide
        onSubmit={form.handleSubmit((values) => {
          const { academicYearId, ...rest } = values;
          save.mutate(entity ? { id: entity.id, ...rest } : { academicYearId, ...rest }, {
            onSuccess: (saved) => {
              toast.success('Session saved');
              setOpen(false);
              onSaved?.(saved);
            },
            onError: (err) =>
              setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
          });
        })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="academicYearId"
            label="Academic year"
            disabled={!!entity}
            options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))}
          />
          <SelectField
            control={form.control}
            name="type"
            label="Type"
            options={SESSION_TYPES.map((t) => ({ value: t, label: SESSION_TYPE_LABEL[t]! }))}
          />
          <TextField
            label="Code"
            placeholder="SPRING-2027"
            error={e.code?.message}
            {...form.register('code')}
          />
          <TextField
            label="Name"
            placeholder="Spring 2027"
            error={e.name?.message}
            {...form.register('name')}
          />
          <TextField
            label="Start date"
            type="date"
            error={e.startDate?.message}
            {...form.register('startDate')}
          />
          <TextField
            label="End date"
            type="date"
            error={e.endDate?.message}
            {...form.register('endDate')}
          />
          <SelectField
            control={form.control}
            name="gradingScaleId"
            label="Grading scale"
            allowEmpty
            emptyLabel="Not set yet"
            options={(scales.data ?? [])
              .filter((s) => s.status === 'ACTIVE')
              .map((s) => ({ value: s.id, label: s.name }))}
            className="sm:col-span-2"
          />
        </div>
      </FormDialog>
    </>
  );
}

export function GradingScaleDialog({ entity, trigger }: DialogProps<GradingScale>) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveScale();
  const defaults = {
    name: entity?.name ?? '',
    description: entity?.description ?? '',
    status: (entity?.status ?? 'ACTIVE') as 'ACTIVE',
    entries: entity?.entries ?? [
      { letter: 'P', minPercent: 40, gradePoints: null, isPassing: true, countsInGpa: true },
      { letter: 'F', minPercent: 0, gradePoints: null, isPassing: false, countsInGpa: true },
    ],
  };
  const form = useZodForm(gradingScaleSchema, defaults);
  const entries = useFieldArray({ control: form.control, name: 'entries' });
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const e = form.formState.errors;
  const entriesError =
    (e.entries as { message?: string; root?: { message?: string } } | undefined)?.root?.message ??
    e.entries?.message;
  return (
    <>
      {trigger(() => {
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={entity ? 'Edit grading scale' : 'New grading scale'}
        description="Define grade bands from the highest down. Leave grade points empty for every row to create a pass/fail scale (no GPA)."
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        wide
        onSubmit={form.handleSubmit((values) =>
          save.mutate(
            { id: entity?.id, ...values },
            {
              onSuccess: () => {
                toast.success('Grading scale saved');
                setOpen(false);
              },
              onError: (err) =>
                setError(
                  applyServerErrors(err, form.setError, [
                    'name',
                    'description',
                    'status',
                    'entries',
                  ]),
                ),
            },
          ),
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" error={e.name?.message} {...form.register('name')} />
          {entity && (
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
          )}
        </div>
        <TextareaField control={form.control} name="description" label="Description" rows={2} />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Grade bands</legend>
          <div className="hidden grid-cols-[5rem_6rem_6rem_1fr_1fr_2.5rem] gap-2 text-xs text-muted-foreground sm:grid">
            <span>Letter</span>
            <span>Min %</span>
            <span>Points</span>
            <span>Passing</span>
            <span>Counts in GPA</span>
            <span />
          </div>
          {entries.fields.map((field, i) => (
            <div
              key={field.id}
              className="grid grid-cols-3 gap-2 sm:grid-cols-[5rem_6rem_6rem_1fr_1fr_2.5rem] sm:items-center"
            >
              <Input aria-label={`Letter ${i + 1}`} {...form.register(`entries.${i}.letter`)} />
              <Input
                aria-label={`Minimum percent ${i + 1}`}
                type="number"
                step="0.01"
                {...form.register(`entries.${i}.minPercent`, { valueAsNumber: true })}
              />
              <Input
                aria-label={`Grade points ${i + 1}`}
                type="number"
                step="0.01"
                {...form.register(`entries.${i}.gradePoints`, {
                  setValueAs: (v: string) => (v === '' || v === null ? null : Number(v)),
                })}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.watch(`entries.${i}.isPassing`)}
                  onCheckedChange={(v) => form.setValue(`entries.${i}.isPassing`, v === true)}
                />
                Passing
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.watch(`entries.${i}.countsInGpa`) ?? true}
                  onCheckedChange={(v) => form.setValue(`entries.${i}.countsInGpa`, v === true)}
                />
                In GPA
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove band ${i + 1}`}
                onClick={() => entries.remove(i)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {entriesError && <p className="text-xs font-medium text-destructive">{entriesError}</p>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              entries.append({
                letter: '',
                minPercent: 0,
                gradePoints: null,
                isPassing: true,
                countsInGpa: true,
              })
            }
          >
            <Plus className="size-4" /> Add band
          </Button>
        </fieldset>
      </FormDialog>
    </>
  );
}
