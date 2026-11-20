import { Download, Paperclip } from 'lucide-react';
import { Fragment } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/services/api-error';
import { openDownload } from '../api/queries';
import type { FileRef } from '../api/types';

const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/**
 * User-written text rendered safely (FR-COMM-004): never as HTML. Line breaks
 * are kept and http(s) links become anchors that open in a new tab.
 */
export function PlainText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <p className={className ?? 'text-sm break-words whitespace-pre-wrap'}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-brand underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

/** Attachment chips with a short-lived download link fetched on click. */
export function AttachmentList({
  files,
  linkFor,
}: {
  files: FileRef[];
  linkFor: (fileId: string) => string;
}) {
  if (!files.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {files.map((f) => (
        <li key={f.fileId}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto max-w-64 py-1 text-xs"
            onClick={() =>
              openDownload(linkFor(f.fileId)).catch((e) => toast.error(errorMessage(e)))
            }
          >
            <Paperclip className="size-3.5 shrink-0" />
            <span className="truncate">{f.name}</span>
            <span className="shrink-0 text-muted-foreground">{fileSize(f.sizeBytes)}</span>
            <Download className="size-3.5 shrink-0" aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
