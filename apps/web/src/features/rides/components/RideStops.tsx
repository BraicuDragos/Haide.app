/** From and to as a small rail: start dot, a line, end dot. Decorative rail, the labels carry the meaning. */
export function RideStops({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex items-stretch gap-3">
      <div aria-hidden="true" className="flex flex-none flex-col items-center py-1.5">
        <span className="dot-from size-3.5 rounded-full" />
        <span className="my-1 w-0.5 flex-1 rounded-full bg-border-strong" />
        <span className="dot-to size-3.5 rounded-full" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="min-w-0 truncate text-md leading-6">{from}</p>
        <p className="min-w-0 truncate text-md leading-6">{to}</p>
      </div>
    </div>
  );
}
