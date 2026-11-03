/** Single-owner scheduler. Only explicit, locally registered adapters can run. */
import { randomUUID } from "node:crypto";
import type { DeliveryStore } from "../storage/delivery-store.ts";
import { runJob } from "./jobs.ts";
import { runOutbox } from "./outbox.ts";

type Job = { id: string; repository_id: string; kind: string };
type Intent = Job & { revision: number };
export type Adapters = {
  jobs?: Record<string, (item: Job, signal: AbortSignal) => Promise<void>>;
  outbox?: Record<string, (item: Intent, signal: AbortSignal) => Promise<void>>;
};
type Options = {
  intervalMs?: number;
  leaseMs?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
  maxAttempts?: number;
};

export class DeliveryScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopped = false;
  private readonly intervalMs: number;
  private readonly leaseMs: number;
  private readonly now: () => Date;
  private readonly onError: (error: unknown) => void;
  private readonly maxAttempts: number;
  constructor(
    private readonly store: DeliveryStore,
    private readonly adapters: Adapters,
    options: Options = {},
  ) {
    this.intervalMs = options.intervalMs ?? 5000;
    this.leaseMs = options.leaseMs ?? 60000;
    this.maxAttempts = options.maxAttempts ?? Number.MAX_SAFE_INTEGER;
    if (
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 1 ||
      !Number.isSafeInteger(this.leaseMs) ||
      this.leaseMs < 1 ||
      !Number.isSafeInteger(this.maxAttempts) ||
      this.maxAttempts < 1
    )
      throw new Error("Invalid scheduler timing");
    this.now = options.now ?? (() => new Date());
    this.onError =
      options.onError ??
      ((error) => console.error("Delivery scheduler failed", error));
  }
  start(): void {
    if (this.timer || this.stopped)
      throw new Error("Scheduler already started or stopped");
    const poll = () => {
      void this.tick().catch(this.onError);
    };
    this.timer = setInterval(poll, this.intervalMs);
    this.timer.unref();
    poll();
  }
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active) {
      this.store.recoverExpired(this.now().toISOString(), this.maxAttempts);
      return this.active;
    }
    const current = this.process();
    this.active = current;
    void current
      .finally(() => {
        if (this.active === current) this.active = undefined;
      })
      .catch(() => {});
    return current;
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
  private async bounded(
    adapter: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new Error(
            "Delivery adapter exceeded its lease; reconciliation required",
          ),
        );
      }, this.leaseMs);
    });
    try {
      await Promise.race([
        Promise.resolve().then(() => adapter(controller.signal)),
        deadline,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async process(): Promise<void> {
    this.store.recoverExpired(this.now().toISOString(), this.maxAttempts);
    let attempted = 0;
    const intents = this.store.queuedOutbox(
      Object.keys(this.adapters.outbox ?? {}),
      this.maxAttempts,
    );
    const jobsLimit = intents.length
      ? Math.max(1, Math.ceil(this.maxAttempts / 2))
      : this.maxAttempts;
    for (const job of this.store.queuedJobs(
      Object.keys(this.adapters.jobs ?? {}),
      jobsLimit,
    )) {
      if (this.stopped) return;
      const adapter = Object.hasOwn(this.adapters.jobs ?? {}, job.kind)
        ? this.adapters.jobs?.[job.kind]
        : undefined;
      if (!adapter) continue;
      if (attempted >= this.maxAttempts) return;
      attempted++;
      const now = this.now();
      try {
        await runJob(
          this.store,
          {
            jobId: job.id,
            attemptId: randomUUID(),
            now: now.toISOString(),
            expires: new Date(now.getTime() + this.leaseMs).toISOString(),
          },
          () => this.bounded((signal) => adapter(job, signal)),
          () => this.now().toISOString(),
        );
      } catch (error) {
        this.store.recoverExpired(this.now().toISOString(), this.maxAttempts);
        this.onError(error);
      }
    }
    for (const intent of intents) {
      if (this.stopped) return;
      const adapter = Object.hasOwn(this.adapters.outbox ?? {}, intent.kind)
        ? this.adapters.outbox?.[intent.kind]
        : undefined;
      if (!adapter) continue;
      if (attempted >= this.maxAttempts) return;
      attempted++;
      const now = this.now();
      try {
        await runOutbox(
          this.store,
          {
            intentId: intent.id,
            attemptId: randomUUID(),
            now: now.toISOString(),
            expires: new Date(now.getTime() + this.leaseMs).toISOString(),
          },
          () => this.bounded((signal) => adapter(intent, signal)),
          () => this.now().toISOString(),
        );
      } catch (error) {
        this.store.recoverExpired(this.now().toISOString(), this.maxAttempts);
        this.onError(error);
      }
    }
  }
}
