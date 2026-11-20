import { Download, FileText, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  DOCUMENT_VISIBILITIES,
  FILE_LIMITS,
  type DocumentVisibility,
  type Portal,
} from '@ucrams/shared';
import { FormDialog } from '@/components/forms/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useDepartmentOptions } from '@/features/structure/api/structure-queries';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import {
  openDocument,
  useCreateDocument,
  useDeleteDocument,
  useDocuments,
  type DocumentItem,
} from '../api/platform-queries';

const VISIBILITY_LABEL: Record<DocumentVisibility, string> = {
  ALL_USERS: 'Everyone',
  STUDENTS: 'Students',
  FACULTY: 'Faculty',
  ADMINS: 'Administrators',
};
const ALL = '__all__';

const size = (b: number) =>
  b >= 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`;

function UploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateDocument();
  const departments = useDepartmentOptions();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [visibility, setVisibility] = useState<DocumentVisibility>('ALL_USERS');
  const [departmentId, setDepartmentId] = useState(ALL);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reset = () => {
    setTitle('');
    setDescription('');
    setCategory('');
    setVisibility('ALL_USERS');
    setDepartmentId(ALL);
    setFile(null);
    setError(null);
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Publish a document"
      description="PDF, Word, Excel or PowerPoint, up to 25 MB."
      submitLabel="Publish"
      submitting={create.isPending}
      error={error}
      onSubmit={() => {
        if (!file) return setError('Choose a file');
        if (title.trim().length < 3)
          return setError('Give the document a title (at least 3 characters)');
        if (category.trim().length < 2) return setError('Give the document a category');
        setError(null);
        create.mutate(
          {
            title,
            description,
            category,
            visibility,
            departmentId: departmentId === ALL ? null : departmentId,
            file,
          },
          {
            onSuccess: () => {
              toast.success('Document published');
              reset();
              onOpenChange(false);
            },
            onError: (e) => setError(errorMessage(e)),
          },
        );
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="doc-file">File</Label>
        <Input
          id="doc-file"
          type="file"
          accept={FILE_LIMITS.DOCUMENT.mimeTypes.join(',')}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="doc-title">Title</Label>
        <Input
          id="doc-title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="doc-category">Category</Label>
        <Input
          id="doc-category"
          value={category}
          maxLength={60}
          placeholder="Policies, Forms, Handbooks…"
          onChange={(e) => setCategory(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="doc-description">Description (optional)</Label>
        <Textarea
          id="doc-description"
          value={description}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="doc-visibility">Who can see it</Label>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as DocumentVisibility)}>
            <SelectTrigger id="doc-visibility" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_VISIBILITIES.map((v) => (
                <SelectItem key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="doc-department">Department</Label>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger id="doc-department" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Whole university</SelectItem>
              {(departments.data?.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </FormDialog>
  );
}

function DocumentRow({ doc, manage }: { doc: DocumentItem; manage: boolean }) {
  const remove = useDeleteDocument();
  return (
    <li className="flex flex-wrap items-start gap-3 rounded-lg border p-4">
      <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{doc.title}</p>
        {doc.description && <p className="text-sm text-muted-foreground">{doc.description}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{doc.category}</span>·<span>{size(doc.file.sizeBytes)}</span>·
          <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
          {manage && (
            <>
              <StatusBadge tone="info">{VISIBILITY_LABEL[doc.visibility]}</StatusBadge>
              <StatusBadge tone="neutral">
                {doc.department ? doc.department.code : 'University'}
              </StatusBadge>
            </>
          )}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => openDocument(doc.id).catch((e: unknown) => toast.error(errorMessage(e)))}
        >
          <Download className="size-4" /> Download
        </Button>
        {manage && doc.canManage && (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="outline" aria-label={`Delete ${doc.title}`}>
                <Trash2 className="size-4" />
              </Button>
            }
            title={`Delete “${doc.title}”?`}
            description="The file is removed for everyone. This cannot be undone."
            confirmLabel="Delete"
            destructive
            onConfirm={() =>
              remove.mutate(doc.id, {
                onSuccess: () => toast.success('Document deleted'),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          />
        )}
      </div>
    </li>
  );
}

/** Policies, forms and handbooks published to the caller; managers publish and delete. */
export function DocumentsPage({ portal }: { portal: Portal }) {
  const canManage = useCan('document:manage') && portal === 'admin';
  const [mode, setMode] = useState<'read' | 'manage'>('read');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(ALL);
  const [uploading, setUploading] = useState(false);
  const manage = canManage && mode === 'manage';
  const docs = useDocuments({ q, category: category === ALL ? undefined : category, manage });
  return (
    <>
      <PageHeader
        title="Documents"
        description="Policies, forms and handbooks from the university."
        actions={
          canManage && (
            <Button onClick={() => setUploading(true)}>
              <Plus className="size-4" /> Publish document
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {canManage && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'read' | 'manage')}>
            <TabsList>
              <TabsTrigger value="read">Published to me</TabsTrigger>
              <TabsTrigger value="manage">Manage</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search documents"
          aria-label="Search documents"
          className="w-full sm:w-64"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {(docs.data?.categories ?? []).map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {docs.isPending ? (
        <LoadingRows />
      ) : docs.isError ? (
        <ErrorState error={docs.error} onRetry={() => void docs.refetch()} />
      ) : docs.data.items.length === 0 ? (
        <EmptyState
          title="No documents"
          description={
            q || category !== ALL ? 'Try a different search.' : 'Nothing has been published yet.'
          }
        />
      ) : (
        <ul className="grid gap-3">
          {docs.data.items.map((d) => (
            <DocumentRow key={d.id} doc={d} manage={manage} />
          ))}
        </ul>
      )}
      {canManage && <UploadDialog open={uploading} onOpenChange={setUploading} />}
    </>
  );
}
