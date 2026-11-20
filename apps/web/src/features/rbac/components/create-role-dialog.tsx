import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormAlert } from '@/components/forms/form-alert';
import { TextField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/services/api-error';
import { useCreateRole } from '../api/rbac-queries';

const schema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(100),
  key: z
    .string()
    .trim()
    .regex(
      /^[A-Z][A-Z0-9_]{2,49}$/,
      'Upper-case letters, digits and underscores (3–50), starting with a letter',
    ),
  description: z.string().trim().max(500).optional(),
});
type Values = z.infer<typeof schema>;

const toKey = (name: string) =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

export function CreateRoleDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const create = useCreateRole();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', key: '', description: '' },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          form.reset();
          create.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a custom role</DialogTitle>
          <DialogDescription>
            Start with no permissions, then choose them on the role page.
          </DialogDescription>
        </DialogHeader>
        <form
          id="create-role"
          className="grid gap-4"
          noValidate
          onSubmit={form.handleSubmit((v) =>
            create.mutate(
              { ...v, permissions: [] },
              {
                onSuccess: (role) => {
                  toast.success(`Role “${role.name}” created`);
                  setOpen(false);
                  navigate(`/admin/roles/${role.id}`);
                },
              },
            ),
          )}
        >
          {create.isError && <FormAlert>{errorMessage(create.error)}</FormAlert>}
          <TextField
            label="Name"
            error={form.formState.errors.name?.message}
            {...form.register('name', {
              onChange: (e) => {
                if (!form.formState.dirtyFields.key) form.setValue('key', toKey(e.target.value));
              },
            })}
          />
          <TextField
            label="Key"
            hint="Permanent identifier used by the system"
            error={form.formState.errors.key?.message}
            {...form.register('key')}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Textarea id="role-description" rows={3} {...form.register('description')} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-role" disabled={create.isPending}>
            {create.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
