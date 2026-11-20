import { Loader2, Plus } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { universityUpdateSchema } from '@ucrams/shared';
import { SelectField, TextareaField } from '@/components/forms/fields';
import { FormAlert } from '@/components/forms/form-alert';
import { TextField } from '@/components/forms/form-field';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { EntityStatus } from '@/components/shared/entity-status';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCan } from '@/store/auth-store';
import { useState } from 'react';
import {
  useCampuses,
  useDeleteCampus,
  useUniversityProfile,
  useUpdateUniversity,
} from '../api/structure-queries';
import type { Campus, University } from '../api/types';
import { CampusDialog } from '../components/entity-dialogs';
import { RowActions } from '../components/row-actions';

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

function ProfileForm({ university, canEdit }: { university: University; canEdit: boolean }) {
  const save = useUpdateUniversity();
  const [error, setError] = useState<string | null>(null);
  const defaults = {
    name: university.name,
    shortName: university.shortName,
    timezone: university.timezone,
    schoolLabel: university.schoolLabel as 'Faculty' | 'School',
    website: university.website ?? '',
    contactEmail: university.contactEmail ?? '',
    contactPhone: university.contactPhone ?? '',
    address: university.address ?? '',
    gpaRepeatPolicy: university.gpaRepeatPolicy,
  };
  const form = useZodForm(universityUpdateSchema, defaults);
  useEffect(() => form.reset(defaults), [university.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = form.formState.errors;
  const tzOptions = [...new Set([university.timezone, ...TIMEZONES])].map((t) => ({
    value: t,
    label: t,
  }));
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit((values) => {
        setError(null);
        save.mutate(values, {
          onSuccess: () => toast.success('University profile saved'),
          onError: (err) => setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
        });
      })}
    >
      {error && <FormAlert>{error}</FormAlert>}
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" error={e.name?.message} {...form.register('name')} />
        <TextField
          label="Short name"
          error={e.shortName?.message}
          {...form.register('shortName')}
        />
        <SelectField
          control={form.control}
          name="timezone"
          label="Time zone"
          options={tzOptions}
          hint="Registration deadlines are interpreted in this time zone."
          disabled={!canEdit}
        />
        <SelectField
          control={form.control}
          name="schoolLabel"
          label="Organisational unit label"
          options={[
            { value: 'Faculty', label: 'Faculty' },
            { value: 'School', label: 'School' },
          ]}
          disabled={!canEdit}
        />
        <SelectField
          control={form.control}
          name="gpaRepeatPolicy"
          label="Repeated courses in the CGPA"
          options={[
            { value: 'ALL', label: 'Count every attempt' },
            { value: 'LATEST', label: 'Count the latest attempt' },
            { value: 'BEST', label: 'Count the best attempt' },
          ]}
          hint="Applies to every transcript and CGPA."
          disabled={!canEdit}
        />
        <TextField label="Website" error={e.website?.message} {...form.register('website')} />
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
      </fieldset>
      <fieldset disabled={!canEdit}>
        <TextareaField control={form.control} name="address" label="Address" rows={2} />
      </fieldset>
      {canEdit && (
        <div>
          <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}Save profile
          </Button>
        </div>
      )}
    </form>
  );
}

export function UniversityPage() {
  const university = useUniversityProfile();
  const campuses = useCampuses();
  const remove = useDeleteCampus();
  const canEdit = useCan('university:manage');
  return (
    <>
      <PageHeader title="University" description="Institution profile and campuses." />
      <div className="grid gap-6 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
            <CardDescription>
              Shown on sign-in pages and used for time-sensitive rules.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {university.isPending ? (
              <LoadingRows rows={3} />
            ) : university.isError ? (
              <ErrorState error={university.error} onRetry={() => void university.refetch()} />
            ) : (
              <ProfileForm university={university.data} canEdit={canEdit} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Campuses</CardTitle>
              <CardDescription>
                Physical locations used by faculties, departments and classrooms.
              </CardDescription>
            </div>
            {canEdit && (
              <CampusDialog
                trigger={(open) => (
                  <Button size="sm" onClick={open}>
                    <Plus className="size-4" /> New campus
                  </Button>
                )}
              />
            )}
          </CardHeader>
          <CardContent>
            <DataTable<Campus>
              caption="Campuses"
              isLoading={campuses.isPending}
              error={campuses.error}
              onRetry={() => void campuses.refetch()}
              rows={campuses.data}
              rowKey={(c) => c.id}
              emptyTitle="No campuses yet"
              columns={[
                {
                  key: 'name',
                  header: 'Campus',
                  cell: (c) => <span className="font-medium">{c.name}</span>,
                },
                {
                  key: 'code',
                  header: 'Code',
                  cell: (c) => <span className="font-mono text-xs">{c.code}</span>,
                },
                { key: 'city', header: 'City', cell: (c) => c.city ?? '—', hideOnMobile: true },
                {
                  key: 'usage',
                  header: 'Used by',
                  cell: (c) => `${c.schoolCount} faculties · ${c.departmentCount} departments`,
                  hideOnMobile: true,
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (c) => <EntityStatus status={c.status} />,
                },
                {
                  key: 'actions',
                  header: '',
                  cell: (c) =>
                    canEdit ? (
                      <CampusDialog
                        entity={c}
                        trigger={(open) => (
                          <RowActions
                            label={c.name}
                            onEdit={open}
                            onDelete={() => remove.mutateAsync(c.id)}
                          />
                        )}
                      />
                    ) : null,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
