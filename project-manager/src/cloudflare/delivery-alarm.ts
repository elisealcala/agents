/** One alarm multiplexes independent backup deadlines and bounded delivery ticks. */
export const DELIVERY_INTERVAL_MS = 60_000;
export const DELIVERY_BATCH_SIZE = 5;
export const DELIVERY_LEASE_MS = 5_000;

export function nextWakeup(
  deliveryAt: number,
  backupAt: number | null,
): number {
  if (
    !Number.isSafeInteger(deliveryAt) ||
    deliveryAt < 0 ||
    (backupAt !== null && (!Number.isSafeInteger(backupAt) || backupAt < 0))
  )
    throw new Error("Invalid wakeup time");
  return backupAt === null ? deliveryAt : Math.min(deliveryAt, backupAt);
}
