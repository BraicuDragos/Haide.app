/** Joins the ids that should describe a control; falsy entries are dropped. */
export function joinIds(...ids: Array<string | false | undefined>): string | undefined {
  const out = ids.filter((id): id is string => Boolean(id));
  return out.length > 0 ? out.join(' ') : undefined;
}
