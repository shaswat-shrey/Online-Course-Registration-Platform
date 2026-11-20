import { Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/forms/form-dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useDepartmentOptions,
  usePrograms,
  useProgram,
} from '@/features/structure/api/structure-queries';
import { errorMessage } from '@/services/api-error';
import { useSetCourseRelation } from '../api/courses-queries';
import type { CourseDetail, Restriction } from '../api/types';

type Trigger = (open: () => void) => ReactNode;
type Mapping = 'CORE' | 'ELECTIVE';

function MiniSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  className = 'w-full',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const MAPPING_OPTIONS = [
  { value: 'CORE', label: 'Core' },
  { value: 'ELECTIVE', label: 'Elective' },
];

function useProgramOptions() {
  const programs = usePrograms({ limit: 100 });
  return (programs.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));
}

function SpecializationSelect({
  programId,
  value,
  onChange,
  label,
}: {
  programId: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const program = useProgram(programId);
  const options = (program.data?.specializations ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));
  return (
    <MiniSelect
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={
        programId ? (options.length ? 'Choose…' : 'No specializations') : 'Choose a program first'
      }
    />
  );
}

/** Program and specialization mappings with core/elective type (FR-CRS-002). */
export function MappingsDialog({ course, trigger }: { course: CourseDetail; trigger: Trigger }) {
  const save = useSetCourseRelation(course.id);
  const programOptions = useProgramOptions();
  const [programs, setPrograms] = useState<Array<{ programId: string; mappingType: Mapping }>>([]);
  const [specs, setSpecs] = useState<
    Array<{ programId: string; specializationId: string; mappingType: Mapping }>
  >([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = () => {
    setPrograms(course.programs.map((p) => ({ programId: p.id, mappingType: p.mappingType })));
    setSpecs(
      course.specializations.map((s) => ({
        programId: s.program.id,
        specializationId: s.id,
        mappingType: s.mappingType,
      })),
    );
    setError(null);
    setOpen(true);
  };
  return (
    <>
      {trigger(show)}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Programs using ${course.code}`}
        description="Where this course counts, and whether it is core or an elective there."
        submitLabel="Save mappings"
        submitting={save.isPending}
        error={error}
        wide
        onSubmit={async () => {
          setError(null);
          try {
            await save.mutateAsync({
              relation: 'programs',
              body: { mappings: programs.filter((p) => p.programId) },
            });
            await save.mutateAsync({
              relation: 'specializations',
              body: {
                mappings: specs
                  .filter((s) => s.specializationId)
                  .map(({ specializationId, mappingType }) => ({ specializationId, mappingType })),
              },
            });
            toast.success('Mappings saved');
            setOpen(false);
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Programs</legend>
          {programs.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <MiniSelect
                label={`Program ${i + 1}`}
                value={p.programId}
                options={programOptions.filter(
                  (o) => o.value === p.programId || !programs.some((x) => x.programId === o.value),
                )}
                onChange={(v) =>
                  setPrograms((all) => all.map((x, j) => (j === i ? { ...x, programId: v } : x)))
                }
              />
              <MiniSelect
                label={`Program ${i + 1} type`}
                className="w-32"
                value={p.mappingType}
                options={MAPPING_OPTIONS}
                onChange={(v) =>
                  setPrograms((all) =>
                    all.map((x, j) => (j === i ? { ...x, mappingType: v as Mapping } : x)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove program ${i + 1}`}
                onClick={() => setPrograms((all) => all.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPrograms((all) => [...all, { programId: '', mappingType: 'CORE' }])}
            >
              <Plus className="size-4" /> Add program
            </Button>
          </div>
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Specializations</legend>
          {specs.map((s, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-center">
              <MiniSelect
                label={`Specialization ${i + 1} program`}
                value={s.programId}
                options={programOptions}
                onChange={(v) =>
                  setSpecs((all) =>
                    all.map((x, j) => (j === i ? { ...x, programId: v, specializationId: '' } : x)),
                  )
                }
              />
              <SpecializationSelect
                label={`Specialization ${i + 1}`}
                programId={s.programId}
                value={s.specializationId}
                onChange={(v) =>
                  setSpecs((all) =>
                    all.map((x, j) => (j === i ? { ...x, specializationId: v } : x)),
                  )
                }
              />
              <MiniSelect
                label={`Specialization ${i + 1} type`}
                value={s.mappingType}
                options={MAPPING_OPTIONS}
                onChange={(v) =>
                  setSpecs((all) =>
                    all.map((x, j) => (j === i ? { ...x, mappingType: v as Mapping } : x)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove specialization ${i + 1}`}
                onClick={() => setSpecs((all) => all.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSpecs((all) => [
                  ...all,
                  { programId: '', specializationId: '', mappingType: 'ELECTIVE' },
                ])
              }
            >
              <Plus className="size-4" /> Add specialization
            </Button>
          </div>
        </fieldset>
      </FormDialog>
    </>
  );
}

type RuleDraft = {
  mode: 'INCLUDE' | 'EXCLUDE';
  targetType: Restriction['targetType'];
  targetId: string;
  targetValue: string;
  /** Program for picking a specialization (new rows only). */
  programId: string;
  /** Display label for existing specialization rows. */
  label?: string;
};

const TYPE_OPTIONS = [
  { value: 'DEPARTMENT', label: 'Department' },
  { value: 'PROGRAM', label: 'Program' },
  { value: 'SPECIALIZATION', label: 'Specialization' },
  { value: 'YEAR_OF_STUDY', label: 'Year of study' },
];
const YEAR_OPTIONS = [1, 2, 3, 4, 5, 6].map((y) => ({ value: String(y), label: `Year ${y}` }));

/** Include/exclude rules editor shared by courses and sections (FR-CRS-004). */
export function RestrictionsDialog({
  title,
  initial,
  saving,
  onSave,
  trigger,
}: {
  title: string;
  initial: Restriction[];
  saving: boolean;
  onSave: (body: { restrictions: unknown[] }) => Promise<unknown>;
  trigger: Trigger;
}) {
  const departments = useDepartmentOptions();
  const deptOptions = (departments.data?.data ?? []).map((d) => ({
    value: d.id,
    label: `${d.name} (${d.code})`,
  }));
  const programOptions = useProgramOptions();
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = () => {
    setRules(
      initial.map((r) => ({
        mode: r.mode,
        targetType: r.targetType,
        targetId: r.targetId ?? '',
        targetValue: r.targetValue ? String(r.targetValue) : '',
        programId: '',
        label: r.label,
      })),
    );
    setError(null);
    setOpen(true);
  };
  const set = (i: number, patch: Partial<RuleDraft>) =>
    setRules((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <>
      {trigger(show)}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description="Include rules admit only matching students; exclude rules turn matching students away. Registration enforces them from Phase 6."
        submitLabel="Save restrictions"
        submitting={saving}
        error={error}
        wide
        onSubmit={() => {
          const incomplete = rules.some((r) =>
            r.targetType === 'YEAR_OF_STUDY' ? !r.targetValue : !r.targetId,
          );
          if (incomplete) {
            setError('Choose a target for every rule, or remove it.');
            return;
          }
          onSave({
            restrictions: rules.map((r) => ({
              mode: r.mode,
              targetType: r.targetType,
              targetId: r.targetType === 'YEAR_OF_STUDY' ? null : r.targetId,
              targetValue: r.targetType === 'YEAR_OF_STUDY' ? Number(r.targetValue) : null,
            })),
          }).then(
            () => {
              toast.success('Restrictions saved');
              setOpen(false);
            },
            (err) => setError(errorMessage(err)),
          );
        }}
      >
        {rules.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No restrictions: any eligible student may register.
          </p>
        )}
        {rules.map((r, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[8rem_10rem_1fr_auto] sm:items-center"
          >
            <MiniSelect
              label={`Rule ${i + 1} mode`}
              value={r.mode}
              options={[
                { value: 'INCLUDE', label: 'Only' },
                { value: 'EXCLUDE', label: 'Not' },
              ]}
              onChange={(v) => set(i, { mode: v as RuleDraft['mode'] })}
            />
            <MiniSelect
              label={`Rule ${i + 1} type`}
              value={r.targetType}
              options={TYPE_OPTIONS}
              onChange={(v) =>
                set(i, {
                  targetType: v as RuleDraft['targetType'],
                  targetId: '',
                  targetValue: '',
                  programId: '',
                  label: undefined,
                })
              }
            />
            {r.targetType === 'DEPARTMENT' && (
              <MiniSelect
                label={`Rule ${i + 1} department`}
                value={r.targetId}
                options={deptOptions}
                onChange={(v) => set(i, { targetId: v })}
              />
            )}
            {r.targetType === 'PROGRAM' && (
              <MiniSelect
                label={`Rule ${i + 1} program`}
                value={r.targetId}
                options={programOptions}
                onChange={(v) => set(i, { targetId: v })}
              />
            )}
            {r.targetType === 'YEAR_OF_STUDY' && (
              <MiniSelect
                label={`Rule ${i + 1} year`}
                value={r.targetValue}
                options={YEAR_OPTIONS}
                onChange={(v) => set(i, { targetValue: v })}
              />
            )}
            {r.targetType === 'SPECIALIZATION' &&
              (r.label && !r.programId ? (
                <span className="truncate text-sm">{r.label}</span>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <MiniSelect
                    label={`Rule ${i + 1} program`}
                    value={r.programId}
                    options={programOptions}
                    onChange={(v) => set(i, { programId: v, targetId: '' })}
                  />
                  <SpecializationSelect
                    label={`Rule ${i + 1} specialization`}
                    programId={r.programId}
                    value={r.targetId}
                    onChange={(v) => set(i, { targetId: v })}
                  />
                </div>
              ))}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove rule ${i + 1}`}
              onClick={() => setRules((all) => all.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRules((all) => [
                ...all,
                {
                  mode: 'INCLUDE',
                  targetType: 'PROGRAM',
                  targetId: '',
                  targetValue: '',
                  programId: '',
                },
              ])
            }
          >
            <Plus className="size-4" /> Add rule
          </Button>
        </div>
      </FormDialog>
    </>
  );
}

/** Human-readable restriction summary, e.g. "Only: B.Tech CS · Not: Year 1". */
export function RestrictionList({ rules }: { rules: Restriction[] }) {
  if (!rules.length)
    return <p className="text-sm text-muted-foreground">Open to all eligible students.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {rules.map((r) => (
        <li key={r.id}>
          <span
            className={
              r.mode === 'INCLUDE' ? 'font-medium text-success' : 'font-medium text-destructive'
            }
          >
            {r.mode === 'INCLUDE' ? 'Only' : 'Not'}
          </span>{' '}
          {r.label}
        </li>
      ))}
    </ul>
  );
}
