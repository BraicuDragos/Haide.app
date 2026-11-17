import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { postBlock } from '@/api/safety';
import { t, tError } from '@/i18n';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { invalidateAfterSafety } from './invalidate';

export interface BlockSheetProps {
  open: boolean;
  onClose: () => void;
  user: { id: string; firstName: string | null };
  /**
   * Stay on the current screen after blocking. The driver's ride screen sets it: other passengers are
   * still on that ride, and the blocked one drops out of the refetched list. The public profile does
   * not (the profile is a 404 for the blocker once the block exists).
   */
  stayOnPage?: boolean;
}

/** Block (5.3): mutual and quiet. Done: toast, then My rides (the profile is a 404 for the blocker now). */
export default function BlockSheet({ open, onClose, user, stayOnPage = false }: BlockSheetProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const name = user.firstName ?? t('pub.deleted');

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const block = useMutation({
    mutationFn: () => postBlock(user.id),
    onSuccess: () => {
      invalidateAfterSafety(qc, { userId: user.id });
      toast.show(t('block.toast', { name }));
      onClose();
      if (!stayOnPage) void navigate('/rides', { replace: true });
    },
    onError: (err) => setError(tError(err instanceof ApiError ? err.code : 'NETWORK')),
  });
  const close = () => {
    if (!block.isPending) onClose();
  };

  return (
    <Sheet open={open} title={t('block.title', { name })} onClose={close}>
      <p>{t('block.body')}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mt-auto flex flex-col gap-3">
        <Button variant="danger" block loading={block.isPending} onClick={() => block.mutate()}>
          {t('block.confirm', { name })}
        </Button>
        <Button variant="secondary" block disabled={block.isPending} onClick={close}>
          {t('block.keep')}
        </Button>
      </div>
    </Sheet>
  );
}
