const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Romanian and international phone shapes: +40 721 234 567, 0721234567, 07xx-xxx-xxx
const PHONE_RE = /(?:\+|00)?\d[\d\s().-]{7,}\d/g;
// Decimal coordinate pairs such as 45.79712, 24.15211 (3+ decimals each)
const COORD_RE = /-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;

/** Remove anything that looks like an email, phone, coordinates or token, then truncate. */
export function scrubText(input: string, maxLen: number): string {
  return input
    .replace(JWT_RE, '[token]')
    .replace(BEARER_RE, 'Bearer [token]')
    .replace(EMAIL_RE, '[email]')
    .replace(COORD_RE, '[coords]')
    .replace(PHONE_RE, '[phone]')
    .slice(0, maxLen);
}
