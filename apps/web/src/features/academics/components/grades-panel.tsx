import { CheckCircle2, Send, Undo2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { GradeSubmissionStatus } from '@ucrams/shared';
import { FormDialog } from '@/components/forms/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/services/api-error';
import { formatDateTime } from '@/utils/format';
import {
  useApproveGrades,
  useGradeSheet,
  useReturnGrades,
  useSaveGrades,
  useSubmitGrades,
  type GradeSheet,
} from '../api/academic-queries';

export const SUBMISSION_LABEL: Record<GradeSubmissionStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting approval',
  RETURNED: 'Returned for changes',
  POSTED: 'Posted',
};
export const SUBMISSION_TONE: Record<GradeSubmissionStatus, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  RETURNED: 'warning',
  POSTED: 'success',
};
const NONE = '__none__';

function ReturnDialog({ sectionId }: { sectionId: string }) {
  const ret = useReturnGrades(sectionId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant="outline" onClick={() => (setReason(''), setError(null), setOpen(true))}>
        <Undo2 className="size-4" /> Return
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Return grades to the instructor"
        submitLabel="Return"
        submitting={ret.isPending}
        error={error}
        onSubmit={() => {
          if (reason.trim().length < 5) return setError('Tell the instructor what to fix.');
          ret.mutate(reason.trim(), {
            onSuccess: () => {
              toast.success('Grades returned');
              setOpen(false);
            },
            onError: (e) => setError(errorMessage(e)),
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="return-reason">Reason</Label>
          <Textarea
            id="return-reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
          />
        </div>
      </FormDialog>
    </>
  );
}

function Sheet({ sheet }: { sheet: GradeSheet }) {
  const sectionId = sheet.section.id;
  const save = useSaveGrades(sectionId);
  const submit = useSubmitGrades(sectionId);
  const approve = useApproveGrades(sectionId);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      sheet.students.filter((s) => s.gradeLetter).map((s) => [s.registrationId, s.gradeLetter!]),
    ),
  );
  const editable = sheet.students.filter((s) => s.registrationStatus === 'REGISTERED');
  const changed = editable.filter(
    (s) => draft[s.registrationId] && draft[s.registrationId] !== s.gradeLetter,
  );
  const bands = sheet.scale?.bands ?? [];
  const saveDraft = (onSaved?: () => void) =>
    save.mutate(
      changed.map((s) => ({
        registrationId: s.registrationId,
        gradeLetter: draft[s.registrationId]!,
      })),
      {
        onSuccess: () => (onSaved ? onSaved() : toast.success('Draft saved')),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  const doSubmit = () =>
    submit.mutate(undefined, {
      onSuccess: () => toast.success('Grades submitted for approval'),
      onError: (e) => toast.error(errorMessage(e)),
    });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone={SUBMISSION_TONE[sheet.status]}>
            {SUBMISSION_LABEL[sheet.status]}
          </StatusBadge>
          {sheet.submittedAt && (
            <span className="text-muted-foreground">
              Submitted by {sheet.submittedBy} · {formatDateTime(sheet.submittedAt)}
            </span>
          )}
          {sheet.postedAt && (
            <span className="text-muted-foreground">
              Posted by {sheet.decidedBy} · {formatDateTime(sheet.postedAt)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {sheet.canEdit && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    ...Object.fromEntries(
                      editable
                        .filter((s) => s.suggested && !d[s.registrationId])
                        .map((s) => [s.registrationId, s.suggested!]),
                    ),
                  }))
                }
              >
                <Wand2 className="size-4" /> Fill in suggested
              </Button>
              <Button
                variant="outline"
                disabled={!changed.length || save.isPending}
                onClick={() => saveDraft()}
              >
                Save draft
              </Button>
              <ConfirmDialog
                trigger={
                  <Button disabled={submit.isPending || save.isPending}>
                    <Send className="size-4" /> Submit for approval
                  </Button>
                }
                title="Submit final grades?"
                description="You can't change them until an administrator returns the sheet."
                confirmLabel="Submit"
                onConfirm={() => (changed.length ? saveDraft(doSubmit) : doSubmit())}
              />
            </>
          )}
          {sheet.canDecide && (
            <>
              <ReturnDialog sectionId={sectionId} />
              <ConfirmDialog
                trigger={
                  <Button disabled={approve.isPending}>
                    <CheckCircle2 className="size-4" /> Approve and post
                  </Button>
                }
                title="Approve and post these grades?"
                description="Grades become part of each student's academic record and students are notified."
                confirmLabel="Approve and post"
                onConfirm={() =>
                  approve.mutate(undefined, {
                    onSuccess: (r) => toast.success(`${r.posted} grade(s) posted`),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
              />
            </>
          )}
        </div>
      </div>
      {sheet.status === 'RETURNED' && sheet.returnReason && (
        <p role="alert" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          Returned by {sheet.decidedBy}: {sheet.returnReason}
        </p>
      )}
      {sheet.assessmentWeight > 0 && sheet.assessmentWeight !== 100 && (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          Assessment weights total {sheet.assessmentWeight}%; they must total 100% before you can
          submit.
        </p>
      )}
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full text-sm">
            <caption className="sr-only">Final grades</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Student
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Mark
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Suggested
                </th>
                <th scope="col" className="py-2 pl-2 font-medium">
                  Final grade
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.students.map((s) => (
                <tr key={s.registrationId} className="border-b last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {s.name}{' '}
                    <span className="text-xs text-muted-foreground">{s.studentNumber}</span>
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {s.percent === null ? '—' : `${s.percent}%`}
                  </td>
                  <td className="px-2 py-2">{s.suggested ?? '—'}</td>
                  <td className="py-2 pl-2">
                    {sheet.canEdit && s.registrationStatus === 'REGISTERED' ? (
                      <Select
                        value={draft[s.registrationId] ?? NONE}
                        onValueChange={(v) => setDraft((d) => ({ ...d, [s.registrationId]: v }))}
                      >
                        <SelectTrigger
                          aria-label={`Final grade for ${s.name}`}
                          className="h-8 w-24"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE} disabled>
                            —
                          </SelectItem>
                          {bands.map((b) => (
                            <SelectItem key={b.letter} value={b.letter}>
                              {b.letter}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="font-medium">{s.gradeLetter ?? '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {sheet.scale && (
        <p className="text-xs text-muted-foreground">
          {sheet.scale.name}:{' '}
          {bands
            .map(
              (b) =>
                `${b.letter} ≥ ${b.minPercent}%${b.gradePoints !== null ? ` (${b.gradePoints})` : ''}`,
            )
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

/** Final grade sheet for the primary instructor and approving administrators (FR-ACAD-006). */
export function GradesPanel({ sectionId }: { sectionId: string }) {
  const sheet = useGradeSheet(sectionId);
  if (sheet.isPending) return <LoadingRows rows={4} />;
  if (sheet.isError) return <ErrorState error={sheet.error} onRetry={() => void sheet.refetch()} />;
  const s = sheet.data;
  if (!s.scale)
    return (
      <EmptyState
        title="No grading scale"
        description="This session has no grading scale yet. Ask the registrar to assign one."
      />
    );
  if (!s.students.length)
    return (
      <EmptyState
        title="Nobody to grade"
        description="No students are registered in this section."
      />
    );
  return <Sheet key={s.status} sheet={s} />;
}

export function GradesCard({ sectionId }: { sectionId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Final grades</CardTitle>
        <CardDescription>
          Approve to post grades to academic records, or return with a reason.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GradesPanel sectionId={sectionId} />
      </CardContent>
    </Card>
  );
}
