import { useState } from 'react';

const SIZE = { md: 'size-10 text-lg', lg: 'size-20 text-3xl' } as const;

/**
 * Round photo with an initial as fallback. Decorative: the name is always next to it (accessibility.md 1.1.1),
 * so the image has alt="". Falls back when the photo is missing or fails to load.
 */
export function Avatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name: string | null;
  photoUrl: string | null;
  size?: keyof typeof SIZE;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = photoUrl && failed !== photoUrl;
  return (
    <span
      aria-hidden="true"
      className={`inline-grid flex-none place-items-center overflow-hidden rounded-full bg-primary-100 font-bold text-primary-800 ${SIZE[size]}`}
    >
      {showPhoto ? (
        <img
          src={photoUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(photoUrl)}
        />
      ) : (
        (name?.trim().charAt(0).toUpperCase() ?? '')
      )}
    </span>
  );
}
