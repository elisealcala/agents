import type { DeliveryStore } from "../storage/delivery-store.ts";

/** Runs only an explicitly supplied adapter; no provider is enabled by this module. */
export async function runJob(
  store: DeliveryStore,
  lease: { jobId: string; attemptId: string; now: string; expires: string },
  adapter: () => Promise<void>,
  clock: () => string = () => new Date().toISOString(),
): Promise<void> {
  store.claimJob(lease.jobId, lease.attemptId, lease.now, lease.expires);
  try {
    await adapter();
  } catch (error) {
    // A failed call can have an unknown external outcome. Never retry it blindly.
    try {
      store.finishJob(lease.jobId, lease.attemptId, clock(), "reconciling");
    } catch {
      // An expired or superseded attempt cannot write a result.
    }
    throw error;
  }
  store.finishJob(lease.jobId, lease.attemptId, clock(), "completed");
}
