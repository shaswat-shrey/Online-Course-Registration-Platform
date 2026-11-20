import { Pencil } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useFacultyDirectory } from '@/features/people/api/people-queries';
import { DESIGNATION_LABEL } from '@/features/people/api/types';
import { LeaderDialog } from '@/features/people/components/people-dialogs';
import { useCan } from '@/store/auth-store';
import { useSaveDepartment, useSaveSchool } from '../api/structure-queries';

export interface Leader {
  id: string;
  name: string;
  designation: string;
}

function LeaderValue({ leader }: { leader: Leader | null }) {
  const canRead = useCan('faculty:read');
  if (!leader) return <span className="text-muted-foreground">Not appointed</span>;
  const label = `${leader.name}, ${DESIGNATION_LABEL[leader.designation] ?? leader.designation}`;
  return canRead ? (
    <Link className="hover:underline" to={`/admin/faculty/${leader.id}`}>
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}

function LeaderPicker({
  title,
  leader,
  filter,
  onSave,
  saving,
}: {
  title: string;
  leader: Leader | null;
  filter: { departmentId?: string; schoolId?: string };
  onSave: (id: string | null) => Promise<unknown>;
  saving: boolean;
}) {
  // Only active faculty qualify (the API re-checks membership and status).
  const candidates = useFacultyDirectory({ ...filter, employmentStatus: 'ACTIVE', limit: 100 });
  const options = (candidates.data?.data ?? []).map((f) => ({
    value: f.id,
    label: `${f.firstName} ${f.lastName} (${DESIGNATION_LABEL[f.designation]})`,
  }));
  if (leader && !options.some((o) => o.value === leader.id))
    options.unshift({ value: leader.id, label: leader.name });
  return (
    <LeaderDialog
      title={title}
      currentId={leader?.id ?? null}
      candidates={options}
      onSave={onSave}
      saving={saving}
      trigger={(open) => (
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={open} aria-label={title}>
          <Pencil className="size-3.5" /> Change
        </Button>
      )}
    />
  );
}

export function DepartmentHeadField({
  departmentId,
  head,
  canManage,
}: {
  departmentId: string;
  head: Leader | null;
  canManage: boolean;
}) {
  const save = useSaveDepartment();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <LeaderValue leader={head} />
      {canManage && (
        <LeaderPicker
          title="Appoint head of department"
          leader={head}
          filter={{ departmentId }}
          saving={save.isPending}
          onSave={(headId) => save.mutateAsync({ id: departmentId, headId })}
        />
      )}
    </span>
  );
}

export function SchoolDeanField({
  schoolId,
  dean,
  canManage,
}: {
  schoolId: string;
  dean: Leader | null;
  canManage: boolean;
}) {
  const save = useSaveSchool();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <LeaderValue leader={dean} />
      {canManage && (
        <LeaderPicker
          title="Appoint dean"
          leader={dean}
          filter={{ schoolId }}
          saving={save.isPending}
          onSave={(deanId) => save.mutateAsync({ id: schoolId, deanId })}
        />
      )}
    </span>
  );
}
