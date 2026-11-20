import { Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useFieldArray } from 'react-hook-form';
import { toast } from 'sonner';
import {
  COURSE_CATEGORIES,
  courseCreateSchema,
  courseUpdateSchema,
  SESSION_TYPES,
  type CourseInput,
} from '@ucrams/shared';
import { NumberField, SelectField, SwitchField, TextareaField } from '@/components/forms/fields';
import { FormAlert } from '@/components/forms/form-alert';
import { FormDialog } from '@/components/forms/form-dialog';
import { TextField } from '@/components/forms/form-field';
import type { PickerOption } from '@/components/forms/search-picker';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SESSION_TYPE_LABEL } from '@/features/calendar/api/calendar-queries';
import { useDepartmentOptions } from '@/features/structure/api/structure-queries';
import { CATEGORY_LABEL } from '@/features/structure/api/types';
import { errorMessage } from '@/services/api-error';
import { useSaveCourse, useSetCourseRelation } from '../api/courses-queries';
import type { CourseDetail } from '../api/types';
import { CoursePicker, courseOption, FacultyPicker } from './pickers';

type Trigger = (open: () => void) => ReactNode;

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

const categoryOptions = COURSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] ?? c }));
const sessionTypeOptions = SESSION_TYPES.map((t) => ({
  value: t,
  label: SESSION_TYPE_LABEL[t] ?? t,
}));

/** Create or edit a course's catalog details (FR-CRS-001). */
export function CourseDialog({
  course,
  defaultDepartmentId,
  trigger,
  onSaved,
}: {
  course?: CourseDetail;
  defaultDepartmentId?: string;
  trigger: Trigger;
  onSaved?: (c: CourseDetail) => void;
}) {
  const save = useSaveCourse();
  const departments = useDepartmentOptions();
  const deptOptions = (departments.data?.data ?? [])
    .filter((d) => d.canManage || d.id === course?.department.id)
    .map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }));
  const defaults: CourseInput = course
    ? {
        code: course.code,
        title: course.title,
        description: course.description ?? '',
        departmentId: course.department.id,
        credits: course.credits,
        level: course.level,
        category: course.category as CourseInput['category'],
        recommendedYear: course.recommendedYear,
        recommendedSessionType:
          course.recommendedSessionType as CourseInput['recommendedSessionType'],
        syllabus: course.syllabus ?? '',
        defaultCapacity: course.defaultCapacity,
        minEnrollment: course.minEnrollment,
        coordinatorId: course.coordinator?.id ?? null,
        isRepeatable: course.isRepeatable,
        status: course.status,
        outcomes: course.outcomes,
        assessmentComponents: course.assessmentComponents,
      }
    : {
        code: '',
        title: '',
        description: '',
        departmentId: defaultDepartmentId ?? '',
        credits: 3,
        level: 100,
        category: 'CORE',
        recommendedYear: null,
        recommendedSessionType: null,
        syllabus: '',
        defaultCapacity: 40,
        minEnrollment: null,
        coordinatorId: null,
        isRepeatable: false,
        status: 'DRAFT',
        outcomes: [],
        assessmentComponents: [],
      };
  const form = useZodForm(course ? courseUpdateSchema : courseCreateSchema, defaults);
  const components = useFieldArray({
    control: form.control,
    name: 'assessmentComponents' as never,
  });
  const [outcomes, setOutcomes] = useState('');
  const [coordinator, setCoordinator] = useState<PickerOption | null>(null);
  const d = useDialog(() => {
    form.reset(defaults);
    setOutcomes(defaults.outcomes?.join('\n') ?? '');
    setCoordinator(
      course?.coordinator ? { value: course.coordinator.id, label: course.coordinator.name } : null,
    );
  });
  const departmentId = form.watch('departmentId');
  const e = form.formState.errors;
  const fields = Object.keys(defaults);
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title={course ? `Edit ${course.code}` : 'New course'}
        description={
          course ? undefined : 'New courses start as drafts: invisible to students until activated.'
        }
        submitLabel={course ? 'Save changes' : 'Create course'}
        submitting={save.isPending}
        error={d.error}
        wide
        onSubmit={form.handleSubmit((v) => {
          // Only send what changed when editing, so status rules apply only to status edits.
          const body = course
            ? Object.fromEntries(
                Object.entries(v).filter(
                  ([k, val]) =>
                    JSON.stringify(val) !==
                    JSON.stringify((defaults as Record<string, unknown>)[k]),
                ),
              )
            : v;
          if (course && Object.keys(body).length === 0) {
            d.setOpen(false);
            return;
          }
          save.mutate(
            { id: course?.id, ...body },
            {
              onSuccess: (saved) => {
                toast.success(course ? 'Course saved' : `${saved.code} created`);
                d.setOpen(false);
                onSaved?.(saved);
              },
              onError: (err) => d.setError(applyServerErrors(err, form.setError, fields)),
            },
          );
        })}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Code"
            placeholder="CS101"
            error={e.code?.message}
            {...form.register('code')}
          />
          <TextField
            label="Title"
            className="sm:col-span-2"
            error={e.title?.message}
            {...form.register('title')}
          />
          <SelectField
            control={form.control}
            name="departmentId"
            label="Department"
            options={deptOptions}
            className="sm:col-span-2"
          />
          <SelectField
            control={form.control}
            name="category"
            label="Category"
            options={categoryOptions}
          />
          <NumberField control={form.control} name="credits" label="Credits" step="0.5" min={0} />
          <NumberField
            control={form.control}
            name="level"
            label="Level"
            step="100"
            min={100}
            hint="100–900"
          />
          <NumberField
            control={form.control}
            name="recommendedYear"
            label="Recommended year"
            step="1"
            min={1}
          />
          <SelectField
            control={form.control}
            name="recommendedSessionType"
            label="Usually offered in"
            allowEmpty
            emptyLabel="Any session"
            options={sessionTypeOptions}
          />
          <NumberField
            control={form.control}
            name="defaultCapacity"
            label="Default capacity"
            step="1"
            min={1}
          />
          <NumberField
            control={form.control}
            name="minEnrollment"
            label="Minimum enrollment"
            step="1"
            min={0}
          />
          <div className="grid gap-1.5 sm:col-span-3">
            <Label>Coordinator</Label>
            <FacultyPicker
              label="Coordinator"
              value={coordinator}
              clearable
              filter={departmentId ? { departmentId: String(departmentId) } : {}}
              invalid={!!e.coordinatorId}
              onChange={(o) => {
                setCoordinator(o);
                form.setValue('coordinatorId', o?.value ?? null, { shouldDirty: true });
              }}
            />
            {e.coordinatorId && (
              <p className="text-xs font-medium text-destructive">{e.coordinatorId.message}</p>
            )}
          </div>
        </div>
        <TextareaField control={form.control} name="description" label="Description" rows={3} />
        <div className="grid gap-1.5">
          <Label htmlFor="course-outcomes">Learning outcomes</Label>
          <Textarea
            id="course-outcomes"
            rows={4}
            value={outcomes}
            placeholder="One outcome per line"
            onChange={(ev) => {
              setOutcomes(ev.target.value);
              form.setValue(
                'outcomes',
                ev.target.value
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean),
                { shouldDirty: true },
              );
            }}
          />
          {e.outcomes && (
            <p className="text-xs font-medium text-destructive">
              {e.outcomes.message ?? 'Check the outcomes'}
            </p>
          )}
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Assessment structure</legend>
          {components.fields.map((f, i) => (
            <div key={f.id} className="flex items-end gap-2">
              <TextField
                label="Component"
                className="flex-1"
                error={e.assessmentComponents?.[i]?.name?.message}
                {...form.register(`assessmentComponents.${i}.name` as const)}
              />
              <TextField
                label="Weight %"
                type="number"
                className="w-24"
                error={e.assessmentComponents?.[i]?.weight?.message}
                {...form.register(`assessmentComponents.${i}.weight` as const, {
                  valueAsNumber: true,
                })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove component ${i + 1}`}
                onClick={() => components.remove(i)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {e.assessmentComponents?.message && (
            <p className="text-xs font-medium text-destructive">{e.assessmentComponents.message}</p>
          )}
          {e.assessmentComponents?.root?.message && (
            <p className="text-xs font-medium text-destructive">
              {e.assessmentComponents.root.message}
            </p>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => components.append({ name: '', weight: 10 } as never)}
            >
              <Plus className="size-4" /> Add component
            </Button>
          </div>
        </fieldset>
        <TextareaField control={form.control} name="syllabus" label="Syllabus" rows={4} />
        <SwitchField
          control={form.control}
          name="isRepeatable"
          label="Repeatable for credit"
          description="Students may take it again after passing (e.g. seminars with changing topics)."
        />
        {!course && (
          <SelectField
            control={form.control}
            name="status"
            label="Initial status"
            options={[
              { value: 'DRAFT', label: 'Draft (hidden from students)' },
              { value: 'ACTIVE', label: 'Active' },
            ]}
          />
        )}
      </FormDialog>
    </>
  );
}

type GroupDraft = Array<{ option: PickerOption | null; minGradeLetter: string }>;

/** AND of OR-groups builder (FR-CRS-003). */
export function PrerequisitesDialog({
  course,
  trigger,
}: {
  course: CourseDetail;
  trigger: Trigger;
}) {
  const save = useSetCourseRelation(course.id);
  const [groups, setGroups] = useState<GroupDraft[]>([]);
  const d = useDialog(() =>
    setGroups(
      course.prerequisites.map((g) =>
        g.items.map((i) => ({
          option: courseOption(i.course),
          minGradeLetter: i.minGradeLetter ?? '',
        })),
      ),
    ),
  );
  const update = (gi: number, fn: (g: GroupDraft) => GroupDraft) =>
    setGroups((all) => all.map((g, i) => (i === gi ? fn(g) : g)).filter((g) => g.length > 0));
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title={`Prerequisites for ${course.code}`}
        description="Students must satisfy every group. Within a group, any one course is enough."
        submitLabel="Save prerequisites"
        submitting={save.isPending}
        error={d.error}
        wide
        onSubmit={() => {
          const body = {
            groups: groups
              .map((g) => ({
                items: g
                  .filter((i) => i.option)
                  .map((i) => ({
                    courseId: i.option!.value,
                    minGradeLetter: i.minGradeLetter || null,
                  })),
              }))
              .filter((g) => g.items.length),
          };
          save.mutate(
            { relation: 'prerequisites', body },
            {
              onSuccess: (saved) => {
                toast.success('Prerequisites saved');
                saved.warnings?.forEach((w) => toast.warning(w));
                d.setOpen(false);
              },
              onError: (err) => d.setError(errorMessage(err)),
            },
          );
        }}
      >
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No prerequisites. Add a group to require courses.
          </p>
        )}
        {groups.map((g, gi) => (
          <div key={gi} className="space-y-2">
            {gi > 0 && (
              <p className="text-center text-xs font-semibold tracking-wide text-muted-foreground">
                AND
              </p>
            )}
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Group {gi + 1}: any one of</p>
              {g.map((item, ii) => (
                <div key={ii} className="flex flex-wrap items-center gap-2">
                  {ii > 0 && (
                    <span className="text-xs font-semibold text-muted-foreground">OR</span>
                  )}
                  <CoursePicker
                    label={`Group ${gi + 1} course ${ii + 1}`}
                    className="min-w-0 flex-1"
                    value={item.option}
                    exclude={[course.id]}
                    onChange={(o) =>
                      update(gi, (list) => list.map((x, j) => (j === ii ? { ...x, option: o } : x)))
                    }
                  />
                  <Input
                    aria-label={`Minimum grade for group ${gi + 1} course ${ii + 1}`}
                    placeholder="Min grade"
                    className="w-24"
                    value={item.minGradeLetter}
                    maxLength={2}
                    onChange={(ev) =>
                      update(gi, (list) =>
                        list.map((x, j) =>
                          j === ii ? { ...x, minGradeLetter: ev.target.value.toUpperCase() } : x,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove group ${gi + 1} course ${ii + 1}`}
                    onClick={() => update(gi, (list) => list.filter((_, j) => j !== ii))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  update(gi, (list) => [...list, { option: null, minGradeLetter: '' }])
                }
              >
                <Plus className="size-4" /> Add alternative
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setGroups((all) => [...all, [{ option: null, minGradeLetter: '' }]])}
          >
            <Plus className="size-4" /> Add requirement group
          </Button>
        </div>
      </FormDialog>
    </>
  );
}

/** Course list editor (used for corequisites and requirement-group course lists). */
export function CourseListDialog({
  title,
  description,
  initial,
  excludeId,
  submitLabel,
  saving,
  onSave,
  trigger,
}: {
  title: string;
  description: string;
  initial: Array<{ id: string; code: string; title: string }>;
  excludeId?: string;
  submitLabel: string;
  saving: boolean;
  onSave: (ids: string[]) => Promise<unknown>;
  trigger: Trigger;
}) {
  const [items, setItems] = useState<PickerOption[]>([]);
  const [next, setNext] = useState<PickerOption | null>(null);
  const d = useDialog(() => {
    setItems(initial.map(courseOption));
    setNext(null);
  });
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title={title}
        description={description}
        submitLabel={submitLabel}
        submitting={saving}
        error={d.error}
        onSubmit={() =>
          onSave(items.map((i) => i.value)).then(
            () => d.setOpen(false),
            (err) => d.setError(errorMessage(err)),
          )
        }
      >
        <ul className="space-y-1">
          {items.length === 0 && <li className="text-sm text-muted-foreground">No courses yet.</li>}
          {items.map((i) => (
            <li
              key={i.value}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
            >
              <span className="truncate">{i.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${i.label}`}
                onClick={() => setItems((all) => all.filter((x) => x.value !== i.value))}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1.5">
            <Label>Add a course</Label>
            <CoursePicker
              label="Course to add"
              value={next}
              exclude={[...(excludeId ? [excludeId] : []), ...items.map((i) => i.value)]}
              onChange={(o) => {
                if (o) setItems((all) => [...all, o]);
                setNext(null);
              }}
            />
          </div>
        </div>
      </FormDialog>
    </>
  );
}

export function CorequisitesDialog({
  course,
  trigger,
}: {
  course: CourseDetail;
  trigger: Trigger;
}) {
  const save = useSetCourseRelation(course.id);
  return (
    <CourseListDialog
      title={`Corequisites for ${course.code}`}
      description="Each must be completed already or taken in the same session."
      initial={course.corequisites}
      excludeId={course.id}
      submitLabel="Save corequisites"
      saving={save.isPending}
      trigger={trigger}
      onSave={(courseIds) =>
        save
          .mutateAsync({ relation: 'corequisites', body: { courseIds } })
          .then(() => toast.success('Corequisites saved'))
      }
    />
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <FormAlert>{children}</FormAlert>;
}
