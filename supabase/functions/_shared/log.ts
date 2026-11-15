/**
 * One JSON line per event. Callers pass identifiers, route templates, status and timings only.
 * Never pass request bodies, coordinates, phones, plates, emails or tokens (conventions §6).
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type Logger = (level: 'info' | 'warn' | 'error', event: string, fields?: LogFields) => void;

export const jsonLogger: Logger = (level, event, fields = {}) => {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
};

export const silentLogger: Logger = () => {};
