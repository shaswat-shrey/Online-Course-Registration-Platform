import { Loader2 } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormAlert } from './form-alert';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  submitting: boolean;
  error?: string | null;
  onSubmit: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** Modal form shell: scrollable body, sticky actions, top-level error. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  submitting,
  error,
  onSubmit,
  children,
  wide,
}: Props) {
  const formId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          wide ? 'max-h-[90dvh] overflow-y-auto sm:max-w-2xl' : 'max-h-[90dvh] overflow-y-auto'
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          id={formId}
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {error && <FormAlert>{error}</FormAlert>}
          {children}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
