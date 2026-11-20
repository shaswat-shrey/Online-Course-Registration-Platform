import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ASSESSMENT_TYPES, type AssessmentType } from '@ucrams/shared';
import { TextField } from '@/components/forms/form-field';
import { FormDialog } from '@/components/forms/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/services/api-error';
import { formatDateTime } from '@/utils/format';
import {
  useCreateAssessment,
  useDeleteAssessment,
  useGradebook,
  useSaveScores,
  useUpdateAssessment,
  type Assessment,
  type Gradebook,
} from '../api/academic-queries';

export const ASSESSMENT_TYPE_LABEL: Record<AssessmentType, string> = {
  ASSIGNMENT: 'Assignment',
  QUIZ: 'Quiz',
  EXAM: 'Exam',
  PROJECT: 'Project',
  LAB: 'Lab',
  OTHER: 'Other',
};

const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function AssessmentDialog({ sectionId, existing }: { sectionId: string; existing?: Assessment }) {
  const create = useCreateAssessment(sectionId);
  const update = useUpdateAssessment();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssessmentType>('ASSIGNMENT');
  const [weight, setWeight] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  return (
    <>
      {existing ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${existing.title}`}
          onClick={() => {
            setTitle(existing.title);
            setType(existing.type);
            setWeight(String(existing.weight));
            setMaxScore(String(existing.maxScore));
            setDue(toLocal(existing.dueAt));
            setError(null);
            setOpen(true);
          }}
        >
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button
          onClick={() => {
            setTitle('');
            setType('ASSIGNMENT');
            setWeight('');
            setMaxScore('');
            setDue('');
            setError(null);
            setOpen(true);
          }}
        >
          <Plus className="size-4" /> Add assessment
        </Button>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={existing ? 'Edit assessment' : 'Add assessment'}
        description="Weights across the section must total 100 % before final grades are submitted."
        submitLabel="Save"
        submitting={pending}
        error={error}
        onSubmit={() => {
          const body = {
            title: title.trim(),
            type,
            weight: Number(weight),
            maxScore: Number(maxScore),
            dueAt: due ? new Date(due).toISOString() : null,
          };
          if (body.title.length < 2) return setError('Give it a title.');
          if (!(body.weight > 0) || !(body.maxScore > 0))
            return setError('Weight and maximum score must be above 0.');
          const done = {
            onSuccess: () => {
              toast.success('Assessment saved');
              setOpen(false);
            },
            onError: (e: unknown) => setError(errorMessage(e)),
          };
          if (existing) update.mutate({ id: existing.id, ...body }, done);
          else create.mutate(body, done);
        }}
      >
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <div className="grid gap-1.5">
          <Label id="assessment-type-label">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as AssessmentType)}>
            <SelectTrigger aria-labelledby="assessment-type-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSESSMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ASSESSMENT_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="assessment-weight">Weight (%)</Label>
            <Input
              id="assessment-weight"
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="assessment-max">Maximum score</Label>
            <Input
              id="assessment-max"
              type="number"
              min={1}
              step="0.5"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="assessment-due">Due (optional)</Label>
            <Input
              id="assessment-due"
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        </div>
      </FormDialog>
    </>
  );
}

function ScoreSheet({
  book,
  assessment,
  onDone,
}: {
  book: Gradebook;
  assessment: Assessment;
  onDone: () => void;
}) {
  const save = useSaveScores();
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      book.students.map((s) => {
        const c = s.scores[assessment.id];
        return [
          s.studentId,
          {
            score: c?.score === null || c?.score === undefined ? '' : String(c.score),
            excused: c?.excused ?? false,
          },
        ];
      }),
    ),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scores · {assessment.title}</CardTitle>
        <CardDescription>
          Out of {assessment.maxScore}. Leave blank if not yet marked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-md border">
          {book.students.map((s) => {
            const row = rows[s.studentId]!;
            return (
              <li
                key={s.studentId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className="min-w-0 text-sm">
                  {s.name} <span className="text-xs text-muted-foreground">{s.studentNumber}</span>
                </span>
                <span className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={0}
                    max={assessment.maxScore}
                    step="0.5"
                    aria-label={`Score for ${s.name}`}
                    className="w-24"
                    disabled={row.excused}
                    value={row.score}
                    onChange={(e) =>
                      setRows((r) => ({ ...r, [s.studentId]: { ...row, score: e.target.value } }))
                    }
                  />
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={row.excused}
                      onCheckedChange={(v) =>
                        setRows((r) => ({
                          ...r,
                          [s.studentId]: { score: v ? '' : row.score, excused: !!v },
                        }))
                      }
                    />
                    Excused
                  </label>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2">
          <Button
            disabled={save.isPending}
            onClick={() => {
              const scores = Object.entries(rows)
                .filter(([, r]) => r.excused || r.score !== '')
                .map(([studentId, r]) => ({
                  studentId,
                  score: r.excused ? null : Number(r.score),
                  excused: r.excused,
                }));
              if (!scores.length) return onDone();
              save.mutate(
                { id: assessment.id, scores },
                {
                  onSuccess: () => {
                    toast.success('Scores saved');
                    onDone();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              );
            }}
          >
            Save scores
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Assessment components, score entry and the weighted gradebook (FR-ACAD-004). */
export function AssessmentsPanel({ sectionId }: { sectionId: string }) {
  const book = useGradebook(sectionId);
  const update = useUpdateAssessment();
  const remove = useDeleteAssessment();
  const [scoring, setScoring] = useState<string | null>(null);
  if (book.isPending) return <LoadingRows rows={4} />;
  if (book.isError) return <ErrorState error={book.error} onRetry={() => void book.refetch()} />;
  const b = book.data;
  const active = b.assessments.find((a) => a.id === scoring);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Weights total{' '}
          <StatusBadge tone={b.totalWeight === 100 ? 'success' : 'warning'}>
            {b.totalWeight}%
          </StatusBadge>
        </p>
        {b.canManage && <AssessmentDialog sectionId={sectionId} />}
      </div>
      {active && (
        <ScoreSheet key={active.id} book={b} assessment={active} onDone={() => setScoring(null)} />
      )}
      {b.assessments.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          description="Add quizzes, assignments and exams with their weights."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {b.assessments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="min-w-0">
                <span className="font-medium">{a.title}</span>{' '}
                <span className="text-xs text-muted-foreground">
                  {ASSESSMENT_TYPE_LABEL[a.type]} · {a.weight}% · out of {a.maxScore}
                  {a.dueAt && ` · due ${formatDateTime(a.dueAt)}`}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <StatusBadge tone={a.published ? 'success' : 'neutral'}>
                  {a.published ? 'Published' : 'Hidden'}
                </StatusBadge>
                {b.canManage && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setScoring(a.id)}>
                      Enter scores
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={a.published ? `Hide ${a.title}` : `Publish ${a.title}`}
                      onClick={() =>
                        update.mutate(
                          { id: a.id, published: !a.published },
                          {
                            onSuccess: () =>
                              toast.success(
                                a.published ? 'Hidden from students' : 'Published to students',
                              ),
                            onError: (e) => toast.error(errorMessage(e)),
                          },
                        )
                      }
                    >
                      {a.published ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                    <AssessmentDialog sectionId={sectionId} existing={a} />
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={`Delete ${a.title}`}>
                          <Trash2 className="size-4" />
                        </Button>
                      }
                      title={`Delete ${a.title}?`}
                      description="Its scores are deleted too."
                      confirmLabel="Delete"
                      destructive
                      onConfirm={() =>
                        remove.mutate(a.id, { onError: (e) => toast.error(errorMessage(e)) })
                      }
                    />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {b.assessments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gradebook</CardTitle>
            <CardDescription>
              Weighted mark: unmarked work counts as zero, excused work is left out.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Scores by student and assessment</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Student
                  </th>
                  {b.assessments.map((a) => (
                    <th
                      key={a.id}
                      scope="col"
                      className="px-2 py-2 text-right font-medium whitespace-nowrap"
                    >
                      {a.title}
                    </th>
                  ))}
                  <th scope="col" className="py-2 pl-2 text-right font-medium">
                    Mark
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.students.map((s) => (
                  <tr key={s.studentId} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal whitespace-nowrap">
                      {s.name}
                    </th>
                    {b.assessments.map((a) => {
                      const c = s.scores[a.id];
                      return (
                        <td key={a.id} className="px-2 py-2 text-right tabular-nums">
                          {c?.excused ? 'Exc.' : (c?.score ?? '—')}
                        </td>
                      );
                    })}
                    <td className="py-2 pl-2 text-right font-medium tabular-nums">
                      {s.percent === null ? '—' : `${s.percent}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
