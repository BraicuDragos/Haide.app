import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { getMe, patchProfile, putPhoto } from '@/api/account';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import type { Me } from '@/api/types';
import { useAdvance } from '@/auth/hooks';
import { t, tError } from '@/i18n';
import { preparePhoto, PhotoError } from '@/lib/image';
import { isValidFirstName, normalizeRoPhone } from '@/lib/validation';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { TextArea, TextField } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { useToast } from '@/ui/Toast';

type Errors = { photo?: string; firstName?: string; phone?: string; bio?: string };

/**
 * Photo, first name, phone and optional bio (screen 1.4). Used for onboarding (`setup`, continues the flow) and for
 * Edit profile (`edit`, saves and goes back). Photo is shrunk in the browser before upload.
 */
export function ProfileForm({ me, mode }: { me: Me; mode: 'setup' | 'edit' }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const advance = useAdvance();
  const toast = useToast();

  const [firstName, setFirstName] = useState(me.firstName ?? '');
  const [phone, setPhone] = useState(me.phoneE164 ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const photoBtn = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const bioRef = useRef<HTMLTextAreaElement>(null);

  const previewUrl = photo?.url ?? me.photoUrl;
  const hasPhoto = Boolean(previewUrl);

  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await preparePhoto(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setErrors((e) => ({ ...e, photo: undefined }));
    } catch (e) {
      const problem = e instanceof PhotoError ? e.problem : 'invalid';
      setErrors((x) => ({
        ...x,
        photo: problem === 'size' ? t('profile.err.photoSize') : t('profile.err.photoInvalid'),
      }));
    }
    if (fileRef.current) fileRef.current.value = ''; // picking the same file again must still fire change
  }

  function focusFirst(e: Errors) {
    if (e.photo) photoBtn.current?.focus();
    else if (e.firstName) nameRef.current?.focus();
    else if (e.phone) phoneRef.current?.focus();
    else if (e.bio) bioRef.current?.focus();
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    const next: Errors = {};
    if (!hasPhoto) next.photo = t('profile.err.photo');
    else if (errors.photo) next.photo = errors.photo;
    if (!isValidFirstName(firstName)) next.firstName = t('profile.err.name');
    if (!normalizeRoPhone(phone)) next.phone = t('profile.err.phone');
    setErrors(next);
    if (Object.keys(next).length) return focusFirst(next);

    setBusy(true);
    try {
      await patchProfile({ firstName: firstName.trim(), phone: phone.trim(), bio: bio.trim() });
      if (photo) await putPhoto(photo.blob);
      const fresh = await getMe();
      qc.setQueryData(keys.me, fresh);
      if (mode === 'setup') await advance(fresh);
      else {
        toast.show(t('profile.saved'));
        void navigate('/profile', { replace: true });
      }
    } catch (err) {
      setBusy(false);
      const code = err instanceof ApiError ? err.code : undefined;
      const fields = err instanceof ApiError ? err.fields : undefined;
      const server: Errors = {};
      if (fields?.firstName) server.firstName = t('profile.err.name');
      if (fields?.phone) server.phone = t('profile.err.phone');
      if (fields?.bio) server.bio = tError('VALIDATION_FAILED');
      if (code === 'PHOTO_TOO_LARGE') server.photo = t('profile.err.photoSize');
      if (code === 'PHOTO_INVALID') server.photo = t('profile.err.photoInvalid');
      if (Object.keys(server).length) {
        setErrors(server);
        focusFirst(server);
      } else setError(tError(code));
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="type-label" id="photo-label">
          {t('profile.photo')}
        </span>
        <div className="flex items-center gap-4">
          <Avatar name={firstName || me.email} photoUrl={previewUrl} size="lg" />
          <div className="flex flex-col items-start gap-1">
            <Button
              ref={photoBtn}
              variant="secondary"
              icon={<Icon name="camera" />}
              onClick={() => fileRef.current?.click()}
              aria-describedby={['photo-hint', errors.photo ? 'photo-err' : ''].join(' ').trim()}
              aria-invalid={errors.photo ? true : undefined}
              id="photo-btn"
            >
              {hasPhoto ? t('profile.photo.change') : t('profile.photo.add')}
            </Button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          aria-label={t('profile.photo')}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <p id="photo-hint" className="text-sm leading-5 text-text-muted">
          {t('profile.photo.hint')}
        </p>
        {errors.photo && (
          <p
            id="photo-err"
            role="alert"
            className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-error"
          >
            <Icon name="alert" small className="mt-0.5" />
            {errors.photo}
          </p>
        )}
      </div>

      <TextField
        id="profile-name"
        ref={nameRef}
        label={t('profile.firstName')}
        error={errors.firstName}
        autoComplete="given-name"
        maxLength={40}
        required
        value={firstName}
        onChange={(e) => {
          setFirstName(e.target.value);
          setErrors((x) => ({ ...x, firstName: undefined }));
        }}
      />
      <TextField
        id="profile-phone"
        ref={phoneRef}
        label={t('profile.phone')}
        hint={t('profile.phone.hint')}
        error={errors.phone}
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        required
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setErrors((x) => ({ ...x, phone: undefined }));
        }}
      />
      <TextArea
        id="profile-bio"
        ref={bioRef}
        label={t('profile.bio')}
        optional
        hint={t('profile.bio.hint', { n: bio.length })}
        error={errors.bio}
        maxLength={200}
        placeholder={t('profile.bio.placeholder')}
        value={bio}
        onChange={(e) => setBio(e.target.value)}
      />

      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" block loading={busy}>
        {mode === 'setup' ? t('setup.profile.cta') : t('common.save')}
      </Button>
    </form>
  );
}
