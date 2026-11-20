import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/shared/user-avatar';
import { Button } from '@/components/ui/button';
import { authApi } from '@/features/auth/api/auth-api';
import { errorMessage } from '@/services/api-error';
import { apiDelete, apiPut } from '@/services/http';
import { useAuthStore } from '@/store/auth-store';
import { uploadAvatarFile } from '../api/uploads';

/** Profile photo editor for the signed-in user. */
export function AvatarUploader() {
  const me = useAuthStore((s) => s.me);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const refreshMe = async () => {
    useAuthStore.getState().setMe(await authApi.me());
    await qc.invalidateQueries({ queryKey: ['people'] });
  };
  const upload = useMutation({
    mutationFn: async (file: File) =>
      apiPut('/me/avatar', { fileId: await uploadAvatarFile(file) }),
    onSuccess: async () => {
      await refreshMe();
      toast.success('Profile photo updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete('/me/avatar'),
    onSuccess: async () => {
      await refreshMe();
      toast.success('Profile photo removed');
    },
  });
  if (!me) return null;
  const busy = upload.isPending || remove.isPending;
  return (
    <div className="flex items-center gap-4">
      <UserAvatar
        firstName={me.user.firstName}
        lastName={me.user.lastName}
        url={me.user.avatarUrl}
        className="size-16 text-lg"
      />
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Choose a profile photo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Camera className="size-4" />
          )}
          {me.user.avatarUrl ? 'Change photo' : 'Upload photo'}
        </Button>
        {me.user.avatarUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => remove.mutate()}
          >
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
        <p className="basis-full text-xs text-muted-foreground">PNG, JPEG or WebP, up to 5 MB.</p>
      </div>
    </div>
  );
}
