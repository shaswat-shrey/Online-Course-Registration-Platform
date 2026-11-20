import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  campusCreateSchema,
  COURSE_CATEGORIES,
  DEGREE_LEVELS,
  degreeCreateSchema,
  departmentCreateSchema,
  programCreateSchema,
  REQUIREMENT_KINDS,
  requirementGroupCreateSchema,
  schoolCreateSchema,
  specializationCreateSchema,
} from '@ucrams/shared';
import { NumberField, SelectField, TextareaField } from '@/components/forms/fields';
import { TextField } from '@/components/forms/form-field';
import { FormDialog } from '@/components/forms/form-dialog';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { STATUS_OPTIONS } from '@/components/shared/entity-status';
import {
  useCampuses,
  useDegrees,
  useDepartmentOptions,
  useSaveCampus,
  useSaveDegree,
  useSaveDepartment,
  useSaveProgram,
  useSaveRequirementGroup,
  useSaveSchool,
  useSaveSpecialization,
  useSchoolOptions,
} from '../api/structure-queries';
import {
  CATEGORY_LABEL,
  DEGREE_LEVEL_LABEL,
  REQUIREMENT_KIND_LABEL,
  type Campus,
  type Degree,
  type Department,
  type Program,
  type RequirementGroup,
  type School,
  type Specialization,
} from '../api/types';

interface DialogProps<T> {
  /** Entity to edit; omit to create. */
  entity?: T;
  trigger: (open: () => void) => ReactNode;
  onSaved?: (saved: { id: string }) => void;
}

/** Shared open/submit/error wiring for entity dialogs. */
function useDialogState() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { open, setOpen, error, setError };
}

export function CampusDialog({ entity, trigger }: DialogProps<Campus>) {
  const { open, setOpen, error, setError } = useDialogState();
  const save = useSaveCampus();
  const defaults = {
    code: entity?.code ?? '',
    name: entity?.name ?? '',
    city: entity?.city ?? '',
    address: entity?.address ?? '',
    status: (entity?.status ?? 'ACTIVE') as 'ACTIVE',
  };
  const form = useZodForm(campusCreateSchema, defaults);
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = form.handleSubmit((values) =>
    save.mutate(
      { id: entity?.id, ...values },
      {
        onSuccess: () => {
          toast.success(entity ? 'Campus updated' : 'Campus created');
          setOpen(false);
        },
        onError: (e) => setError(applyServerErrors(e, form.setError, Object.keys(defaults))),
      },
    ),
  );
  return (
    <>
      {trigger(() => {
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={entity ? 'Edit campus' : 'New campus'}
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        onSubmit={submit}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Code"
            error={form.formState.errors.code?.message}
            {...form.register('code')}
          />
          <TextField
            label="Name"
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <TextField
            label="City"
            error={form.formState.errors.city?.message}
            {...form.register('city')}
          />
          {entity && (
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
          )}
        </div>
        <TextareaField control={form.control} name="address" label="Address" rows={2} />
      </FormDialog>
    </>
  );
}

export function SchoolDialog({ entity, trigger, onSaved }: DialogProps<School>) {
  const { open, setOpen, error, setError } = useDialogState();
  const save = useSaveSchool();
  const campuses = useCampuses();
  const defaults = {
    code: entity?.code ?? '',
    name: entity?.name ?? '',
    description: entity?.description ?? '',
    campusId: entity?.campus?.id ?? null,
    contactEmail: entity?.contactEmail ?? '',
    contactPhone: entity?.contactPhone ?? '',
    website: entity?.website ?? '',
    status: (entity?.status ?? 'ACTIVE') as 'ACTIVE',
  };
  const form = useZodForm(schoolCreateSchema, defaults);
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = form.handleSubmit((values) =>
    save.mutate(
      { id: entity?.id, ...values },
      {
        onSuccess: (saved) => {
          toast.success(entity ? 'Faculty updated' : 'Faculty created');
          setOpen(false);
          onSaved?.(saved);
        },
        onError: (e) => setError(applyServerErrors(e, form.setError, Object.keys(defaults))),
      },
    ),
  );
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
        title={entity ? 'Edit faculty / school' : 'New faculty / school'}
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        onSubmit={submit}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <TextField label="Code" error={e.code?.message} {...form.register('code')} />
          <TextField label="Name" error={e.name?.message} {...form.register('name')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="campusId"
            label="Campus"
            allowEmpty
            emptyLabel="No specific campus"
            options={(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          {entity && (
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
          )}
          <TextField
            label="Contact email"
            type="email"
            error={e.contactEmail?.message}
            {...form.register('contactEmail')}
          />
          <TextField
            label="Contact phone"
            error={e.contactPhone?.message}
            {...form.register('contactPhone')}
          />
          <TextField
            label="Website"
            error={e.website?.message}
            placeholder="https://"
            {...form.register('website')}
            className="sm:col-span-2"
          />
        </div>
        <TextareaField control={form.control} name="description" label="Description" />
      </FormDialog>
    </>
  );
}

export function DepartmentDialog({
  entity,
  trigger,
  onSaved,
  defaultSchoolId,
}: DialogProps<Department> & { defaultSchoolId?: string }) {
  const { open, setOpen, error, setError } = useDialogState();
  const save = useSaveDepartment();
  const schools = useSchoolOptions();
  const campuses = useCampuses();
  const defaults = {
    code: entity?.code ?? '',
    name: entity?.name ?? '',
    description: entity?.description ?? '',
    schoolId: entity?.school.id ?? defaultSchoolId ?? '',
    campusId: entity?.campus?.id ?? null,
    contactEmail: entity?.contactEmail ?? '',
    contactPhone: entity?.contactPhone ?? '',
    officeLocation: entity?.officeLocation ?? '',
    status: (entity?.status ?? 'ACTIVE') as 'ACTIVE',
  };
  const form = useZodForm(departmentCreateSchema, defaults);
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = form.handleSubmit((values) =>
    save.mutate(
      { id: entity?.id, ...values },
      {
        onSuccess: (saved) => {
          toast.success(entity ? 'Department updated' : 'Department created');
          setOpen(false);
          onSaved?.(saved);
        },
        onError: (err) => setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
      },
    ),
  );
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
        title={entity ? 'Edit department' : 'New department'}
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        onSubmit={submit}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <TextField label="Code" error={e.code?.message} {...form.register('code')} />
          <TextField label="Name" error={e.name?.message} {...form.register('name')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="schoolId"
            label="Faculty / school"
            options={(schools.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
          <SelectField
            control={form.control}
            name="campusId"
            label="Campus"
            allowEmpty
            emptyLabel="Same as faculty"
            options={(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <TextField
            label="Contact email"
            type="email"
            error={e.contactEmail?.message}
            {...form.register('contactEmail')}
          />
          <TextField
            label="Contact phone"
            error={e.contactPhone?.message}
            {...form.register('contactPhone')}
          />
          <TextField
            label="Office location"
            error={e.officeLocation?.message}
            {...form.register('officeLocation')}
          />
          {entity && (
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
          )}
        </div>
        <TextareaField control={form.control} name="description" label="Description" />
      </FormDialog>
    </>
  );
}

export function DegreeDialog({ entity, trigger }: DialogProps<Degree>) {
  const { open, setOpen, error, setError } = useDialogState();
  const save = useSaveDegree();
  const defaults = {
    code: entity?.code ?? '',
    name: entity?.name ?? '',
    level: (entity?.level ?? 'UNDERGRADUATE') as 'UNDERGRADUATE',
    description: entity?.description ?? '',
    status: (entity?.status ?? 'ACTIVE') as 'ACTIVE',
  };
  const form = useZodForm(degreeCreateSchema, defaults);
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = form.handleSubmit((values) =>
    save.mutate(
      { id: entity?.id, ...values },
      {
        onSuccess: () => {
          toast.success(entity ? 'Degree updated' : 'Degree created');
          setOpen(false);
        },
        onError: (err) => setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
      },
    ),
  );
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
        title={entity ? 'Edit degree' : 'New degree'}
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        onSubmit={submit}
      >
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <TextField label="Code" error={e.code?.message} {...form.register('code')} />
          <TextField label="Name" error={e.name?.message} {...form.register('name')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="level"
            label="Level"
            options={DEGREE_LEVELS.map((l) => ({ value: l, label: DEGREE_LEVEL_LABEL[l]! }))}
          />
          {entity && (
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
          )}
        </div>
        <TextareaField control={form.control} name="description" label="Description" />
      </FormDialog>
    </>
  );
}

export function ProgramDialog({
  entity,
  trigger,
  onSaved,
  defaultDepartmentId,
}: DialogProps<Program> & { defaultDepartmentId?: string }) {
  const { open, setOpen, error, setError } = useDialogState();
  const save = useSaveProgram();
  const degrees = useDegrees();
  const departments = useDepartmentOptions();
  const defaults = {
    code: entity?.code ?? '',
    name: entity?.name ?? '',
    description: entity?.description ?? '',
    degreeId: entity?.degree.id ?? '',
    departmentId: entity?.department.id ?? defaultDepartmentId ?? '',
    durationYears: entity?.durationYears ?? 4,
    sessionCount: entity?.sessionCount ?? 8,
    totalCredits: entity?.totalCredits ?? (undefined as unknown as number),
    minCoreCredits: entity?.minCoreCredits ?? null,
    minElectiveCredits: entity?.minElectiveCredits ?? null,
    status: (entity?.status ?? 'ACTIVE') as 'ACTIVE',
  };
  const form = useZodForm(programCreateSchema, defaults);
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = form.handleSubmit((values) =>
    save.mutate(
      { id: entity?.id, ...values },
      {
        onSuccess: (saved) => {
          toast.success(entity ? 'Program updated' : 'Program created');
          setOpen(false);
          onSaved?.(saved);
        },
        onError: (err) => setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
      },
    ),
  );
  const e = form.formState.errors;
  // Only departments the user can manage are offered (the API enforces the same).
  const deptOptions = (departments.data?.data ?? [])
    .filter((d) => d.canManage || d.id === defaults.departmentId)
    .map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }));
  return (
    <>
      {trigger(() => {
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={entity ? 'Edit program' : 'New program'}
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        onSubmit={submit}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <TextField label="Code" error={e.code?.message} {...form.register('code')} />
          <TextField
            label="Name"
            placeholder="e.g. B.Tech in Computer Science"
            error={e.name?.message}
            {...form.register('name')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="degreeId"
            label="Degree"
            options={(degrees.data ?? [])
              .filter((d) => d.status === 'ACTIVE')
              .map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))}
          />
          <SelectField
            control={form.control}
            name="departmentId"
            label="Owning department"
            options={deptOptions}
          />
          <NumberField
            control={form.control}
            name="durationYears"
            label="Duration (years)"
            step="0.5"
            min={0.5}
          />
          <NumberField
            control={form.control}
            name="sessionCount"
            label="Number of sessions"
            step="1"
            min={1}
          />
          <NumberField
            control={form.control}
            name="totalCredits"
            label="Total credits required"
            step="0.5"
            min={0}
          />
          {entity && (
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
          )}
          <NumberField
            control={form.control}
            name="minCoreCredits"
            label="Minimum core credits"
            step="0.5"
            hint="Optional"
          />
          <NumberField
            control={form.control}
            name="minElectiveCredits"
            label="Minimum elective credits"
            step="0.5"
            hint="Optional"
          />
        </div>
        <TextareaField control={form.control} name="description" label="Description" />
      </FormDialog>
    </>
  );
}

export function SpecializationDialog({
  entity,
  programId,
  trigger,
}: DialogProps<Specialization> & { programId: string }) {
  const { open, setOpen, error, setError } = useDialogState();
  const save = useSaveSpecialization();
  const defaults = {
    programId,
    code: entity?.code ?? '',
    name: entity?.name ?? '',
    description: entity?.description ?? '',
    additionalCredits: entity?.additionalCredits ?? null,
    status: (entity?.status ?? 'ACTIVE') as 'ACTIVE',
  };
  const form = useZodForm(specializationCreateSchema, defaults);
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = form.handleSubmit((values) => {
    const { programId: pid, ...rest } = values;
    save.mutate(entity ? { id: entity.id, ...rest } : { programId: pid, ...rest }, {
      onSuccess: () => {
        toast.success(entity ? 'Specialization updated' : 'Specialization created');
        setOpen(false);
      },
      onError: (err) => setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
    });
  });
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
        title={entity ? 'Edit specialization' : 'New specialization'}
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        onSubmit={submit}
      >
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <TextField label="Code" error={e.code?.message} {...form.register('code')} />
          <TextField label="Name" error={e.name?.message} {...form.register('name')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            control={form.control}
            name="additionalCredits"
            label="Additional credits"
            step="0.5"
            hint="On top of the program's requirements"
          />
          {entity && (
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
          )}
        </div>
        <TextareaField control={form.control} name="description" label="Description" />
      </FormDialog>
    </>
  );
}

export function RequirementGroupDialog({
  entity,
  owner,
  trigger,
}: DialogProps<RequirementGroup> & {
  owner: { programId: string } | { specializationId: string };
}) {
  const { open, setOpen, error, setError } = useDialogState();
  const save = useSaveRequirementGroup();
  const defaults = {
    name: entity?.name ?? '',
    description: entity?.description ?? '',
    kind: (entity?.kind ?? 'CREDITS_ANY') as 'CREDITS_ANY',
    minCredits: entity?.minCredits ?? null,
    category: (entity?.category ?? null) as null,
    position: entity?.position,
  };
  const form = useZodForm(requirementGroupCreateSchema, defaults);
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const kind = form.watch('kind');
  const submit = form.handleSubmit((values) =>
    save.mutate(
      { id: entity?.id, owner: entity ? undefined : owner, ...values },
      {
        onSuccess: () => {
          toast.success(entity ? 'Requirement updated' : 'Requirement added');
          setOpen(false);
        },
        onError: (err) => setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
      },
    ),
  );
  return (
    <>
      {trigger(() => {
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={entity ? 'Edit requirement' : 'New requirement'}
        submitLabel="Save"
        submitting={save.isPending}
        error={error}
        onSubmit={submit}
      >
        <TextField
          label="Name"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <SelectField
          control={form.control}
          name="kind"
          label="Rule"
          options={REQUIREMENT_KINDS.map((k) => ({ value: k, label: REQUIREMENT_KIND_LABEL[k]! }))}
          hint={
            kind === 'ALL_OF' || kind === 'CREDITS_FROM_LIST'
              ? 'Courses are attached to this list when the course catalog is set up.'
              : undefined
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {kind !== 'ALL_OF' && (
            <NumberField
              control={form.control}
              name="minCredits"
              label="Minimum credits"
              step="0.5"
            />
          )}
          {kind === 'CREDITS_FROM_CATEGORY' && (
            <SelectField
              control={form.control}
              name="category"
              label="Course category"
              options={COURSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c]! }))}
            />
          )}
        </div>
        <TextareaField control={form.control} name="description" label="Description" rows={2} />
      </FormDialog>
    </>
  );
}
