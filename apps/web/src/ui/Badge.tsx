/** Small count badge. Visual only: put the spoken equivalent in the parent's accessible name. */
export function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute top-1.5 left-[calc(50%+6px)] grid min-w-5 place-items-center rounded-full bg-outline px-1 text-xs leading-5 font-bold text-surface ring-2 ring-surface"
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
