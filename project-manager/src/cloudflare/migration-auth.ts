import { timingSafeEqual } from "node:crypto";

/** A separately provisioned credential gates migration-only internal operations. */
export function validMigrationToken(
  token: string | undefined,
  serviceToken: string,
): token is string {
  return Boolean(
    token &&
      token.length >= 32 &&
      /^[\x21-\x7e]+$/.test(token) &&
      token !== serviceToken,
  );
}
export function verifyMigrationToken(
  provided: string | null,
  expected: string | undefined,
  serviceToken: string,
): boolean {
  if (!provided || !validMigrationToken(expected, serviceToken)) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
