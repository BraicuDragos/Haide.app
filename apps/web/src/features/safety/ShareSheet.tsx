import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { deleteShareLink, postShareLink } from '@/api/safety';
import type { BookingView } from '@/api/types';
import { t, tError } from '@/i18n';
import { formatTime } from '@/lib/format';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { clearShare, readShare, saveShare, type StoredShare } from './shareStore';

export interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  booking: Pick<BookingView, 'id' | 'share'>;
}

/**
 * Share trip link (5.5): the passenger creates a read-only link for someone they trust. The server shows the URL once
 * (it keeps only a hash), so this device remembers it until it expires. A new link replaces the old one; Stop sharing
 * revokes it.
 */
export default function ShareSheet({ open, onClose, booking }: ShareSheetProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const uid = useId();
  const [link, setLink] = useState<StoredShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!open) return;
    setLink(readShare(booking.id));
    setError(null);
  }, [open, booking.id]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.bookings.one(booking.id) });
  };
  const create = useMutation({
    mutationFn: () => postShareLink(booking.id),
    onSuccess: (res) => {
      saveShare(booking.id, res);
      setLink(res);
      setError(null);
      refresh();
    },
    onError: (err) => setError(tError(err instanceof ApiError ? err.code : 'NETWORK')),
  });
  const stop = useMutation({
    mutationFn: () => deleteShareLink(booking.id),
    onSuccess: () => {
      clearShare(booking.id);
      setLink(null);
      toast.show(t('rideday.share.stopped'));
      refresh();
      onClose();
    },
    onError: (err) => setError(tError(err instanceof ApiError ? err.code : 'NETWORK')),
  });
  const busy = create.isPending || stop.isPending;
  const close = () => {
    if (!busy) onClose();
  };

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.show(t('rideday.share.copied'));
    } catch {
      // No clipboard permission: select the text so a long press can copy it.
      (document.getElementById(`${uid}-url`) as HTMLInputElement | null)?.select();
    }
  }
  async function send() {
    if (!link) return;
    try {
      await navigator.share({ title: t('rideday.share'), url: link.url });
    } catch {
      /* the person closed the share dialog */
    }
  }

  const active = booking.share?.active === true;
  const hasLink = link !== null || active;

  return (
    <Sheet open={open} title={t('rideday.share')} onClose={close}>
      <p>{t('rideday.share.body')}</p>
      {link ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-url`} className="type-label">
              {t('rideday.share.link')}
            </label>
            <input
              id={`${uid}-url`}
              readOnly
              value={link.url}
              aria-describedby={`${uid}-hint`}
              onFocus={(e) => e.currentTarget.select()}
              className="control min-h-12 border border-border-strong"
            />
            <p id={`${uid}-hint`} className="text-sm leading-5 text-text-muted">
              {t('rideday.share.linkHint')}{' '}
              {t('share.expires', { time: formatTime(link.expiresAt) })}
            </p>
          </div>
          <div className={`grid gap-3 ${canNativeShare ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <Button variant="tonal" icon={<Icon name="doc" />} onClick={() => void copy()}>
              {t('rideday.share.copy')}
            </Button>
            {canNativeShare && (
              <Button variant="tonal" icon={<Icon name="share" />} onClick={() => void send()}>
                {t('rideday.share.send')}
              </Button>
            )}
          </div>
        </>
      ) : active ? (
        <Notice tone="info">{t('rideday.share.elsewhere')}</Notice>
      ) : null}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mt-auto flex flex-col gap-3">
        {hasLink ? (
          <>
            <p className="text-sm leading-5 text-text-muted">{t('rideday.share.newWarn')}</p>
            <Button
              variant="secondary"
              block
              loading={create.isPending}
              disabled={stop.isPending}
              onClick={() => create.mutate()}
            >
              {t('rideday.share.new')}
            </Button>
            <Button
              variant="danger"
              block
              loading={stop.isPending}
              disabled={create.isPending}
              onClick={() => stop.mutate()}
            >
              {t('rideday.share.stop')}
            </Button>
          </>
        ) : (
          <Button block loading={create.isPending} onClick={() => create.mutate()}>
            {t('rideday.share.create')}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
