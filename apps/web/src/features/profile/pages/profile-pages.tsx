import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { facultySelfUpdateSchema, studentSelfUpdateSchema } from '@ucrams/shared';
import { TextareaField } from '@/components/forms/fields';
import { FormAlert } from '@/components/forms/form-alert';
import { TextField } from '@/components/forms/form-field';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { DetailList } from '@/components/shared/detail-list';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useMyFacultyRecord,
  useMyStudentRecord,
  useUpdateMyFaculty,
  useUpdateMyStudent,
} from '@/features/people/api/people-queries';
import {
  DESIGNATION_LABEL,
  HOLD_LABEL,
  STUDENT_STATUS_LABEL,
  type FacultyDetail,
  type StudentDetail,
} from '@/features/people/api/types';
import { AvatarUploader } from '@/features/people/components/avatar-uploader';
import { useState } from 'react';

function StudentContactForm({ student }: { student: StudentDetail }) {
  const save = useUpdateMyStudent();
  const [error, setError] = useState<string | null>(null);
  const c = student.contact;
  const defaults = {
    phone: student.phone ?? '',
    contact: {
      personalEmail: c?.personalEmail ?? '',
      addressLine: c?.addressLine ?? '',
      city: c?.city ?? '',
      state: c?.state ?? '',
      postalCode: c?.postalCode ?? '',
      country: c?.country ?? '',
      emergencyContactName: c?.emergencyContactName ?? '',
      emergencyContactPhone: c?.emergencyContactPhone ?? '',
      emergencyContactRelation: c?.emergencyContactRelation ?? '',
    },
  };
  const form = useZodForm(studentSelfUpdateSchema, defaults);
  const e = form.formState.errors;
  const ce = e.contact ?? {};
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit((v) => {
        setError(null);
        save.mutate(v, {
          onSuccess: () => {
            toast.success('Profile saved');
            form.reset(v);
          },
          onError: (err) => setError(applyServerErrors(err, form.setError, ['phone', 'contact'])),
        });
      })}
    >
      {error && <FormAlert>{error}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Phone" error={e.phone?.message} {...form.register('phone')} />
        <TextField
          label="Personal email"
          type="email"
          error={ce.personalEmail?.message}
          {...form.register('contact.personalEmail')}
        />
        <TextField
          label="Address"
          className="sm:col-span-2"
          error={ce.addressLine?.message}
          {...form.register('contact.addressLine')}
        />
        <TextField label="City" {...form.register('contact.city')} />
        <TextField label="State" {...form.register('contact.state')} />
        <TextField label="Postal code" {...form.register('contact.postalCode')} />
        <TextField label="Country" {...form.register('contact.country')} />
        <TextField label="Emergency contact" {...form.register('contact.emergencyContactName')} />
        <TextField label="Relationship" {...form.register('contact.emergencyContactRelation')} />
        <TextField
          label="Emergency phone"
          error={ce.emergencyContactPhone?.message}
          {...form.register('contact.emergencyContactPhone')}
        />
      </div>
      <div>
        <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}Save changes
        </Button>
      </div>
    </form>
  );
}

export function StudentProfilePage() {
  const record = useMyStudentRecord();
  if (record.isPending) return <LoadingRows rows={5} />;
  if (record.isError)
    return <ErrorState error={record.error} onRetry={() => void record.refetch()} />;
  const s = record.data;
  const activeHolds = s.holds.filter((h) => !h.releasedAt);
  return (
    <>
      <PageHeader title="My profile" description="Your academic record and contact details." />
      <div className="grid gap-6 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Photo</CardTitle>
          </CardHeader>
          <CardContent>
            <AvatarUploader />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Academic record</CardTitle>
            <CardDescription>
              Contact the registrar’s office if anything here is wrong.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailList
              items={[
                {
                  label: 'Student number',
                  value: <span className="font-mono">{s.studentNumber}</span>,
                },
                { label: 'Name', value: `${s.firstName} ${s.lastName}` },
                { label: 'University email', value: s.email },
                {
                  label: 'Status',
                  value: (
                    <StatusBadge tone={s.status === 'ACTIVE' ? 'success' : 'warning'}>
                      {STUDENT_STATUS_LABEL[s.status]}
                    </StatusBadge>
                  ),
                },
                { label: 'Program', value: s.program.name },
                { label: 'Department', value: s.department.name },
                { label: 'Specialization', value: s.specialization?.name ?? 'Not chosen yet' },
                { label: 'Year of study', value: s.yearOfStudy },
                { label: 'Admission', value: s.admissionSession?.name ?? '—' },
              ]}
            />
            {activeHolds.length > 0 && (
              <FormAlert>
                You have {activeHolds.length} registration hold(s):{' '}
                {activeHolds
                  .map((h) => `${HOLD_LABEL[h.type]}${h.reason ? ` (${h.reason})` : ''}`)
                  .join('; ')}
                . Holds block course registration until they are released.
              </FormAlert>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact details</CardTitle>
            <CardDescription>
              Only you and authorised university staff can see these.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StudentContactForm key={s.id} student={s} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function FacultyProfileForm({ member }: { member: FacultyDetail }) {
  const save = useUpdateMyFaculty();
  const [error, setError] = useState<string | null>(null);
  const defaults = {
    phone: member.phone ?? '',
    officeLocation: member.officeLocation ?? '',
    officeHours: member.officeHours ?? '',
    qualifications: member.qualifications ?? '',
    specialization: member.specialization ?? '',
    researchInterests: member.researchInterests ?? '',
  };
  const form = useZodForm(facultySelfUpdateSchema, defaults);
  useEffect(() => form.reset(defaults), [member.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit((v) => {
        setError(null);
        save.mutate(v, {
          onSuccess: () => {
            toast.success('Profile saved');
            form.reset(v);
          },
          onError: (err) => setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
        });
      })}
    >
      {error && <FormAlert>{error}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Phone" error={e.phone?.message} {...form.register('phone')} />
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
        <TextField
          label="Specialization"
          error={e.specialization?.message}
          {...form.register('specialization')}
        />
        <TextField
          label="Qualifications"
          className="sm:col-span-2"
          error={e.qualifications?.message}
          {...form.register('qualifications')}
        />
      </div>
      <TextareaField
        control={form.control}
        name="researchInterests"
        label="Research interests"
        rows={3}
      />
      <div>
        <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}Save changes
        </Button>
      </div>
    </form>
  );
}

export function FacultyProfilePage() {
  const record = useMyFacultyRecord();
  if (record.isPending) return <LoadingRows rows={5} />;
  if (record.isError)
    return <ErrorState error={record.error} onRetry={() => void record.refetch()} />;
  const f = record.data;
  return (
    <>
      <PageHeader title="My profile" description="How you appear in the faculty directory." />
      <div className="grid gap-6 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Photo</CardTitle>
          </CardHeader>
          <CardContent>
            <AvatarUploader />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Appointment</CardTitle>
            <CardDescription>Managed by your department.</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                {
                  label: 'Employee number',
                  value: <span className="font-mono">{f.employeeNumber}</span>,
                },
                { label: 'Designation', value: DESIGNATION_LABEL[f.designation] },
                { label: 'Department', value: f.department.name },
                {
                  label: 'Joint appointments',
                  value: f.secondaryDepartments.map((d) => d.name).join(', ') || 'None',
                },
                {
                  label: 'Leadership',
                  value:
                    [
                      ...f.headOf.map((d) => `Head, ${d.name}`),
                      ...f.deanOf.map((s) => `Dean, ${s.name}`),
                    ].join('; ') || 'None',
                },
                {
                  label: 'Teaching load limit',
                  value: f.maxLoadCredits ? `${f.maxLoadCredits} credits per session` : 'Not set',
                },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Directory details</CardTitle>
            <CardDescription>Visible to students and colleagues.</CardDescription>
          </CardHeader>
          <CardContent>
            <FacultyProfileForm member={f} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
