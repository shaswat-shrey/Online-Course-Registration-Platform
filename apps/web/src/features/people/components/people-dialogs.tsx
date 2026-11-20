import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  adminCreateSchema,
  FACULTY_DESIGNATIONS,
  facultyCreateSchema,
  HOLD_TYPES,
  holdCreateSchema,
  programChangeSchema,
  STUDENT_STATUSES,
  studentContactSchema,
  studentCreateSchema,
  studentStatusSchema,
} from '@ucrams/shared';
import { NumberField, SelectField, SwitchField, TextareaField } from '@/components/forms/fields';
import { TextField } from '@/components/forms/form-field';
import { FormDialog } from '@/components/forms/form-dialog';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { useSessions } from '@/features/calendar/api/calendar-queries';
import { useRoles } from '@/features/rbac/api/rbac-queries';
import {
  useDepartmentOptions,
  usePrograms,
  useProgram,
} from '@/features/structure/api/structure-queries';
import {
  useChangeProgram,
  usePlaceHold,
  useSaveAdministrator,
  useSaveFaculty,
  useSaveStudent,
  useStudentStatus,
} from '../api/people-queries';
import {
  DESIGNATION_LABEL,
  HOLD_LABEL,
  STUDENT_STATUS_LABEL,
  type FacultyDetail,
  type StudentDetail,
} from '../api/types';
import { ScopeFields } from './roles-card';

type Trigger = (open: () => void) => ReactNode;

/** Open/error state + reset on open. */
function useDialog(reset: () => void) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    open,
    setOpen,
    error,
    setError,
    show: () => {
      reset();
      setError(null);
      setOpen(true);
    },
  };
}

/** Programs the user may place students in (manageable ones only). */
function useManageablePrograms() {
  const programs = usePrograms({ limit: 100, status: 'ACTIVE' });
  return (programs.data?.data ?? [])
    .filter((p) => p.canManage)
    .map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` }));
}

function SpecializationSelect({ control, programId }: { control: never; programId: string }) {
  const program = useProgram(programId);
  const specs = (program.data?.specializations ?? []).filter((s) => s.status === 'ACTIVE');
  if (!programId || specs.length === 0) return null;
  return (
    <SelectField
      control={control}
      name="specializationId"
      label="Specialization"
      allowEmpty
      emptyLabel="None yet"
      options={specs.map((s) => ({ value: s.id, label: s.name }))}
    />
  );
}

// ----- students -------------------------------------------------------------------------

const studentEditSchema = studentCreateSchema.pick({
  firstName: true,
  lastName: true,
  yearOfStudy: true,
  cohort: true,
  phone: true,
  admissionSessionId: true,
  expectedGraduationYear: true,
});

export function NewStudentDialog({
  trigger,
  onSaved,
}: {
  trigger: Trigger;
  onSaved?: (s: { id: string }) => void;
}) {
  const save = useSaveStudent();
  const programs = useManageablePrograms();
  const sessions = useSessions();
  const defaults = {
    email: '',
    firstName: '',
    lastName: '',
    studentNumber: '',
    programId: '',
    specializationId: null,
    admissionSessionId: null,
    yearOfStudy: 1,
    cohort: '',
    phone: '',
    sendInvite: true,
  };
  const form = useZodForm(studentCreateSchema, defaults);
  const d = useDialog(() => form.reset(defaults));
  const programId = form.watch('programId');
  useEffect(() => form.setValue('specializationId', null), [programId, form]);
  const e = form.formState.errors;
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title="New student"
        description="Creates the student record and an account. The student sets a password from the invitation email."
        submitLabel="Create student"
        submitting={save.isPending}
        error={d.error}
        wide
        onSubmit={form.handleSubmit((v) =>
          save.mutate(v, {
            onSuccess: (s) => {
              toast.success(`Student ${s.studentNumber} created`);
              d.setOpen(false);
              onSaved?.(s);
            },
            onError: (err) =>
              d.setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
          }),
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            error={e.firstName?.message}
            {...form.register('firstName')}
          />
          <TextField label="Last name" error={e.lastName?.message} {...form.register('lastName')} />
          <TextField
            label="University email"
            type="email"
            error={e.email?.message}
            {...form.register('email')}
          />
          <TextField
            label="Student number"
            hint="Leave empty to generate"
            error={e.studentNumber?.message}
            {...form.register('studentNumber')}
          />
          <SelectField
            control={form.control}
            name="programId"
            label="Program"
            options={programs}
            className="sm:col-span-2"
          />
          <SpecializationSelect control={form.control as never} programId={programId} />
          <NumberField
            control={form.control}
            name="yearOfStudy"
            label="Year of study"
            step="1"
            min={1}
          />
          <SelectField
            control={form.control}
            name="admissionSessionId"
            label="Admission session"
            allowEmpty
            emptyLabel="Not recorded"
            options={(sessions.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField
            label="Cohort"
            placeholder="Batch 2026"
            error={e.cohort?.message}
            {...form.register('cohort')}
          />
          <TextField label="Phone" error={e.phone?.message} {...form.register('phone')} />
        </div>
        <SwitchField
          control={form.control}
          name="sendInvite"
          label="Send invitation email now"
          description="You can resend it later from the student’s page."
        />
      </FormDialog>
    </>
  );
}

export function EditStudentDialog({
  student,
  trigger,
}: {
  student: StudentDetail;
  trigger: Trigger;
}) {
  const save = useSaveStudent();
  const sessions = useSessions();
  const defaults = {
    firstName: student.firstName,
    lastName: student.lastName,
    yearOfStudy: student.yearOfStudy,
    cohort: student.cohort ?? '',
    phone: student.phone ?? '',
    admissionSessionId: student.admissionSession?.id ?? null,
    expectedGraduationYear: student.expectedGraduationYear,
  };
  const form = useZodForm(studentEditSchema, defaults);
  const d = useDialog(() => form.reset(defaults));
  const e = form.formState.errors;
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title="Edit student"
        submitLabel="Save"
        submitting={save.isPending}
        error={d.error}
        onSubmit={form.handleSubmit((v) =>
          save.mutate(
            { id: student.id, ...v },
            {
              onSuccess: () => {
                toast.success('Student updated');
                d.setOpen(false);
              },
              onError: (err) =>
                d.setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
            },
          ),
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            error={e.firstName?.message}
            {...form.register('firstName')}
          />
          <TextField label="Last name" error={e.lastName?.message} {...form.register('lastName')} />
          <NumberField
            control={form.control}
            name="yearOfStudy"
            label="Year of study"
            step="1"
            min={1}
          />
          <NumberField
            control={form.control}
            name="expectedGraduationYear"
            label="Expected graduation year"
            step="1"
          />
          <SelectField
            control={form.control}
            name="admissionSessionId"
            label="Admission session"
            allowEmpty
            emptyLabel="Not recorded"
            options={(sessions.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField label="Cohort" error={e.cohort?.message} {...form.register('cohort')} />
          <TextField label="Phone" error={e.phone?.message} {...form.register('phone')} />
        </div>
      </FormDialog>
    </>
  );
}

export function ContactDialog({ student, trigger }: { student: StudentDetail; trigger: Trigger }) {
  const save = useSaveStudent();
  const c = student.contact;
  const defaults = {
    personalEmail: c?.personalEmail ?? '',
    dateOfBirth: c?.dateOfBirth ?? '',
    addressLine: c?.addressLine ?? '',
    city: c?.city ?? '',
    state: c?.state ?? '',
    postalCode: c?.postalCode ?? '',
    country: c?.country ?? '',
    emergencyContactName: c?.emergencyContactName ?? '',
    emergencyContactPhone: c?.emergencyContactPhone ?? '',
    emergencyContactRelation: c?.emergencyContactRelation ?? '',
  };
  const form = useZodForm(studentContactSchema, defaults);
  const d = useDialog(() => form.reset(defaults));
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title="Edit contact details"
        submitLabel="Save"
        submitting={save.isPending}
        error={d.error}
        wide
        onSubmit={form.handleSubmit((v) =>
          save.mutate(
            { id: student.id, contact: v },
            {
              onSuccess: () => {
                toast.success('Contact details saved');
                d.setOpen(false);
              },
              onError: (err) =>
                d.setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
            },
          ),
        )}
      >
        <ContactFields form={form} includeDateOfBirth />
      </FormDialog>
    </>
  );
}

/** Contact field grid shared by the admin dialog and the student's own profile. */
export function ContactFields({
  form,
  includeDateOfBirth,
}: {
  form: ReturnType<typeof useZodForm<typeof studentContactSchema>>;
  includeDateOfBirth?: boolean;
}) {
  const e = form.formState.errors;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        label="Personal email"
        type="email"
        error={e.personalEmail?.message}
        {...form.register('personalEmail')}
      />
      {includeDateOfBirth && (
        <TextField
          label="Date of birth"
          type="date"
          error={e.dateOfBirth?.message}
          {...form.register('dateOfBirth')}
        />
      )}
      <TextField
        label="Address"
        className="sm:col-span-2"
        error={e.addressLine?.message}
        {...form.register('addressLine')}
      />
      <TextField label="City" error={e.city?.message} {...form.register('city')} />
      <TextField label="State" error={e.state?.message} {...form.register('state')} />
      <TextField
        label="Postal code"
        error={e.postalCode?.message}
        {...form.register('postalCode')}
      />
      <TextField label="Country" error={e.country?.message} {...form.register('country')} />
      <TextField
        label="Emergency contact"
        error={e.emergencyContactName?.message}
        {...form.register('emergencyContactName')}
      />
      <TextField
        label="Relationship"
        error={e.emergencyContactRelation?.message}
        {...form.register('emergencyContactRelation')}
      />
      <TextField
        label="Emergency phone"
        error={e.emergencyContactPhone?.message}
        {...form.register('emergencyContactPhone')}
      />
    </div>
  );
}

export function ChangeProgramDialog({
  student,
  trigger,
}: {
  student: StudentDetail;
  trigger: Trigger;
}) {
  const change = useChangeProgram(student.id);
  const programs = useManageablePrograms();
  const sessions = useSessions();
  const defaults = {
    programId: student.program.id,
    specializationId: student.specialization?.id ?? null,
    effectiveSessionId: null,
    reason: '',
  };
  const form = useZodForm(programChangeSchema, defaults);
  const d = useDialog(() => form.reset(defaults));
  const programId = form.watch('programId');
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title="Change program or specialization"
        description="Completed courses stay on the student’s record; progress is recalculated against the new requirements."
        submitLabel="Change program"
        submitting={change.isPending}
        error={d.error}
        onSubmit={form.handleSubmit((v) =>
          change.mutate(v, {
            onSuccess: () => {
              toast.success('Program changed');
              d.setOpen(false);
            },
            onError: (err) =>
              d.setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
          }),
        )}
      >
        <SelectField control={form.control} name="programId" label="Program" options={programs} />
        <SpecializationSelect
          key={programId}
          control={form.control as never}
          programId={programId}
        />
        <SelectField
          control={form.control}
          name="effectiveSessionId"
          label="Effective from"
          allowEmpty
          emptyLabel="Immediately"
          options={(sessions.data ?? [])
            .filter((s) => s.status !== 'ARCHIVED')
            .map((s) => ({ value: s.id, label: s.name }))}
        />
        <TextareaField control={form.control} name="reason" label="Reason" rows={3} />
      </FormDialog>
    </>
  );
}

export function StudentStatusDialog({
  student,
  trigger,
}: {
  student: StudentDetail;
  trigger: Trigger;
}) {
  const change = useStudentStatus(student.id);
  const defaults = {
    status: (student.status === 'ACTIVE' ? 'ON_LEAVE' : 'ACTIVE') as 'ACTIVE',
    reason: '',
  };
  const form = useZodForm(studentStatusSchema, defaults);
  const d = useDialog(() => form.reset(defaults));
  const status = form.watch('status');
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title="Change academic status"
        submitLabel="Change status"
        submitting={change.isPending}
        error={d.error}
        onSubmit={form.handleSubmit((v) =>
          change.mutate(v, {
            onSuccess: () => {
              toast.success('Status changed');
              d.setOpen(false);
            },
            onError: (err) =>
              d.setError(applyServerErrors(err, form.setError, ['status', 'reason'])),
          }),
        )}
      >
        <SelectField
          control={form.control}
          name="status"
          label="New status"
          options={STUDENT_STATUSES.filter((s) => s !== student.status).map((s) => ({
            value: s,
            label: STUDENT_STATUS_LABEL[s]!,
          }))}
        />
        {(status === 'SUSPENDED' || status === 'DISMISSED') && (
          <p className="rounded-md bg-warning/15 px-3 py-2 text-sm">
            {status === 'SUSPENDED'
              ? 'The account is suspended and the student is signed out.'
              : 'The account is deactivated.'}
          </p>
        )}
        <TextareaField
          control={form.control}
          name="reason"
          label="Reason (recorded in the audit log)"
          rows={3}
        />
      </FormDialog>
    </>
  );
}

export function HoldDialog({ studentId, trigger }: { studentId: string; trigger: Trigger }) {
  const place = usePlaceHold(studentId);
  const defaults = { type: 'ADMINISTRATIVE' as const, reason: '' };
  const form = useZodForm(holdCreateSchema, defaults);
  const d = useDialog(() => form.reset(defaults));
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title="Place a registration hold"
        description="A hold blocks registration until it is released."
        submitLabel="Place hold"
        submitting={place.isPending}
        error={d.error}
        onSubmit={form.handleSubmit((v) =>
          place.mutate(v, {
            onSuccess: () => {
              toast.success('Hold placed');
              d.setOpen(false);
            },
            onError: (err) => d.setError(applyServerErrors(err, form.setError, ['type', 'reason'])),
          }),
        )}
      >
        <SelectField
          control={form.control}
          name="type"
          label="Type"
          options={HOLD_TYPES.map((t) => ({ value: t, label: HOLD_LABEL[t]! }))}
        />
        <TextareaField control={form.control} name="reason" label="Reason" rows={3} />
      </FormDialog>
    </>
  );
}

// ----- faculty ---------------------------------------------------------------------------

const facultyEditSchema = facultyCreateSchema.omit({
  email: true,
  employeeNumber: true,
  sendInvite: true,
});

export function FacultyDialog({
  entity,
  trigger,
  onSaved,
  defaultDepartmentId,
}: {
  entity?: FacultyDetail;
  trigger: Trigger;
  onSaved?: (f: { id: string }) => void;
  defaultDepartmentId?: string;
}) {
  const save = useSaveFaculty();
  const departments = useDepartmentOptions();
  const defaults = {
    email: '',
    employeeNumber: '',
    sendInvite: true,
    firstName: entity?.firstName ?? '',
    lastName: entity?.lastName ?? '',
    departmentId: entity?.department.id ?? defaultDepartmentId ?? '',
    secondaryDepartmentIds: entity?.secondaryDepartments.map((s) => s.id) ?? [],
    designation: (entity?.designation ?? 'ASSISTANT_PROFESSOR') as 'ASSISTANT_PROFESSOR',
    employmentStatus: (entity?.employmentStatus ?? 'ACTIVE') as 'ACTIVE',
    qualifications: entity?.qualifications ?? '',
    specialization: entity?.specialization ?? '',
    researchInterests: entity?.researchInterests ?? '',
    officeLocation: entity?.officeLocation ?? '',
    officeHours: entity?.officeHours ?? '',
    phone: entity?.phone ?? '',
    maxLoadCredits: entity?.maxLoadCredits ?? null,
    joinedOn: entity?.joinedOn ?? '',
  };
  const form = useZodForm(
    entity ? (facultyEditSchema as unknown as typeof facultyCreateSchema) : facultyCreateSchema,
    defaults,
  );
  const d = useDialog(() => form.reset(defaults));
  const e = form.formState.errors;
  const deptOptions = (departments.data?.data ?? []).map((x) => ({
    value: x.id,
    label: `${x.name} (${x.code})`,
  }));
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title={entity ? 'Edit faculty member' : 'New faculty member'}
        description={
          entity ? undefined : 'Creates the faculty record and an account with an invitation email.'
        }
        submitLabel={entity ? 'Save' : 'Create'}
        submitting={save.isPending}
        error={d.error}
        wide
        onSubmit={form.handleSubmit((v) => {
          const body = entity
            ? (({ email: _e, employeeNumber: _n, sendInvite: _s, ...rest }) => rest)(v)
            : v;
          save.mutate(
            { id: entity?.id, ...body },
            {
              onSuccess: (f) => {
                toast.success(
                  entity ? 'Faculty member updated' : `Faculty member ${f.employeeNumber} created`,
                );
                d.setOpen(false);
                onSaved?.(f);
              },
              onError: (err) =>
                d.setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
            },
          );
        })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            error={e.firstName?.message}
            {...form.register('firstName')}
          />
          <TextField label="Last name" error={e.lastName?.message} {...form.register('lastName')} />
          {!entity && (
            <TextField
              label="University email"
              type="email"
              error={e.email?.message}
              {...form.register('email')}
            />
          )}
          {!entity && (
            <TextField
              label="Employee number"
              hint="Leave empty to generate"
              error={e.employeeNumber?.message}
              {...form.register('employeeNumber')}
            />
          )}
          <SelectField
            control={form.control}
            name="departmentId"
            label="Primary department"
            options={deptOptions}
          />
          <SelectField
            control={form.control}
            name="designation"
            label="Designation"
            options={FACULTY_DESIGNATIONS.map((x) => ({ value: x, label: DESIGNATION_LABEL[x]! }))}
          />
          {entity && (
            <SelectField
              control={form.control}
              name="employmentStatus"
              label="Employment"
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'ON_LEAVE', label: 'On leave' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
          )}
          <NumberField
            control={form.control}
            name="maxLoadCredits"
            label="Max teaching load (credits)"
            step="0.5"
          />
          <TextField
            label="Office"
            error={e.officeLocation?.message}
            {...form.register('officeLocation')}
          />
          <TextField
            label="Office hours"
            error={e.officeHours?.message}
            {...form.register('officeHours')}
          />
          <TextField label="Phone" error={e.phone?.message} {...form.register('phone')} />
          <TextField
            label="Joined on"
            type="date"
            error={e.joinedOn?.message}
            {...form.register('joinedOn')}
          />
          <TextField
            label="Specialization"
            error={e.specialization?.message}
            {...form.register('specialization')}
          />
          <TextField
            label="Qualifications"
            error={e.qualifications?.message}
            {...form.register('qualifications')}
          />
        </div>
        <TextareaField
          control={form.control}
          name="researchInterests"
          label="Research interests"
          rows={2}
        />
        {!entity && (
          <SwitchField control={form.control} name="sendInvite" label="Send invitation email now" />
        )}
      </FormDialog>
    </>
  );
}

// ----- administrators ----------------------------------------------------------------

export function NewAdminDialog({
  trigger,
  onSaved,
}: {
  trigger: Trigger;
  onSaved?: (a: { id: string }) => void;
}) {
  const save = useSaveAdministrator();
  const roles = useRoles();
  const defaults = {
    email: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    employeeNumber: '',
    phone: '',
    officeDepartmentId: null,
    roleId: '',
    scopeType: 'GLOBAL' as const,
    scopeId: null,
    sendInvite: true,
  };
  const form = useZodForm(adminCreateSchema, defaults);
  const d = useDialog(() => form.reset(defaults));
  const scopeType = form.watch('scopeType');
  const e = form.formState.errors;
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title="New administrator"
        description="You can grant only roles whose permissions you hold where they apply."
        submitLabel="Create administrator"
        submitting={save.isPending}
        error={d.error}
        wide
        onSubmit={form.handleSubmit((v) =>
          save.mutate(v, {
            onSuccess: (a) => {
              toast.success('Administrator created');
              d.setOpen(false);
              onSaved?.(a);
            },
            onError: (err) =>
              d.setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
          }),
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            error={e.firstName?.message}
            {...form.register('firstName')}
          />
          <TextField label="Last name" error={e.lastName?.message} {...form.register('lastName')} />
          <TextField
            label="University email"
            type="email"
            error={e.email?.message}
            {...form.register('email')}
          />
          <TextField label="Job title" error={e.jobTitle?.message} {...form.register('jobTitle')} />
          <SelectField
            control={form.control}
            name="roleId"
            label="Role"
            options={(roles.data ?? [])
              .filter((r) => r.scopeMode === 'ORGANIZATIONAL')
              .map((r) => ({ value: r.id, label: r.name }))}
          />
          <ScopeFields control={form.control as never} scopeType={scopeType} />
        </div>
        <SwitchField control={form.control} name="sendInvite" label="Send invitation email now" />
      </FormDialog>
    </>
  );
}

// ----- heads and deans ----------------------------------------------------------------------

const leaderSchema = z.object({ leaderId: z.uuid('Choose a person').nullable() });

/** Picks a head of department (from its faculty) or a dean (from the school's faculty). */
export function LeaderDialog({
  title,
  currentId,
  candidates,
  onSave,
  saving,
  trigger,
}: {
  title: string;
  currentId: string | null;
  candidates: Array<{ value: string; label: string }>;
  onSave: (id: string | null) => Promise<unknown>;
  saving: boolean;
  trigger: Trigger;
}) {
  const form = useZodForm(leaderSchema, { leaderId: currentId });
  const d = useDialog(() => form.reset({ leaderId: currentId }));
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title={title}
        submitLabel="Save"
        submitting={saving}
        error={d.error}
        onSubmit={form.handleSubmit((v) =>
          onSave(v.leaderId).then(
            () => {
              toast.success('Appointment saved');
              d.setOpen(false);
            },
            (err: unknown) => d.setError(applyServerErrors(err, form.setError, ['leaderId'])),
          ),
        )}
      >
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There are no active faculty members to choose from yet.
          </p>
        ) : (
          <SelectField
            control={form.control}
            name="leaderId"
            label="Person"
            allowEmpty
            emptyLabel="Vacant"
            options={candidates}
          />
        )}
      </FormDialog>
    </>
  );
}
