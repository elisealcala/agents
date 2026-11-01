import type { DeliveryStore } from "../storage/delivery-store.ts";

/** Uses an explicitly injected adapter; real GitHub dispatch remains disabled. */
export async function runOutbox(
  store: DeliveryStore,
  lease: { intentId: string; attemptId: string; now: string; expires: string },
  adapter: () => Promise<void>,
  clock: () => string = () => new Date().toISOString(),
): Promise<void> {
  store.claimOutbox(lease.intentId, lease.attemptId, lease.now, lease.expires);
  try {
    await adapter();
  } catch (error) {
    try {
      store.finishOutbox(lease.intentId, lease.attemptId, clock(), "unknown");
    } catch {
      // Expired or superseded attempts cannot write a result.
    }
    throw error;
  }
  store.finishOutbox(lease.intentId, lease.attemptId, clock(), "confirmed");
}
