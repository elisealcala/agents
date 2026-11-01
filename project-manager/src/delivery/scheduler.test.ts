import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "../storage/store.ts";
import { DeliveryScheduler } from "./scheduler.ts";

const roots: string[] = [];
const stores: Store[] = [];
const schedulers: DeliveryScheduler[] = [];
const now = () => new Date("2026-11-01T12:00:00.000Z");
const repo = (repositoryId: string) => ({
  provider: "github" as const,
  repositoryId,
  owner: "example",
  name: repositoryId,
});
const intent = (id: string, kind: string) => ({
  id,
  kind,
  operationKey: `operation-${id}`,
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "manager-scheduler-test-"));
  roots.push(root);
  const store = new Store(path.join(root, "manager.sqlite"));
  stores.push(store);
  return store.delivery;
}
function scheduler(...args: ConstructorParameters<typeof DeliveryScheduler>) {
  const value = new DeliveryScheduler(...args);
  schedulers.push(value);
  return value;
}
afterEach(async () => {
  for (const value of schedulers.splice(0)) await value.stop();
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("delivery scheduler", () => {
  it("dispatches registered fake adapters and leaves unregistered kinds queued", async () => {
    const store = await setup();
    store.registerRepository(repo("one"));
    store.registerRepository(repo("two"));
    store.enqueueJob("job-1", "one", "scan");
    store.enqueueJob("job-2", "one", "unknown-job");
    store.transition("one", 0, "in_progress", intent("intent-1", "sync"));
    store.transition(
      "two",
      0,
      "in_progress",
      intent("intent-2", "unknown-intent"),
    );
    const scan = vi.fn(async () => {});
    const sync = vi.fn(async () => {});
    const worker = scheduler(
      store,
      { jobs: { scan }, outbox: { sync } },
      { now },
    );
    await worker.tick();
    expect(scan).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1", repository_id: "one" }),
      expect.any(AbortSignal),
    );
    expect(sync).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "intent-1",
        repository_id: "one",
        revision: 1,
      }),
      expect.any(AbortSignal),
    );
    expect(store.listJobs("one")).toEqual([
      expect.objectContaining({ id: "job-1", status: "completed" }),
      expect.objectContaining({ id: "job-2", status: "queued" }),
    ]);
    expect(store.listOutbox("one")[0]).toMatchObject({ status: "confirmed" });
    expect(store.listOutbox("two")[0]).toMatchObject({ status: "queued" });
    await worker.tick();
    expect(scan).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();
  });

  it("does not dispatch work for a paused repository or an old repository revision", async () => {
    const store = await setup();
    store.registerRepository(repo("paused"));
    store.registerRepository(repo("stale"));
    store.enqueueJob("paused-job", "paused", "scan");
    store.transition("paused", 0, "paused", intent("paused-intent", "sync"));
    store.transition("stale", 0, "in_progress", intent("old", "sync"));
    store.transition("stale", 1, "ready", intent("new", "other"));
    const scan = vi.fn(async () => {});
    const sync = vi.fn(async () => {});
    const worker = scheduler(
      store,
      { jobs: { scan }, outbox: { sync } },
      { now },
    );
    await worker.tick();
    expect(scan).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(store.listJobs("paused")[0]).toMatchObject({ status: "queued" });
    expect(store.listOutbox("paused")[0]).toMatchObject({ status: "queued" });
    expect(
      store.listOutbox("stale").find((item) => item.id === "old"),
    ).toMatchObject({ status: "queued" });
  });

  it("checks pause again at dispatch even after taking a queued-work snapshot", async () => {
    const store = await setup();
    store.registerRepository(repo("one"));
    store.enqueueJob("job-1", "one", "first");
    store.enqueueJob("job-2", "one", "second");
    const first = vi.fn(async () => {
      store.transition("one", 0, "paused", intent("pause", "unused"));
    });
    const second = vi.fn(async () => {});
    const onError = vi.fn();
    const worker = scheduler(
      store,
      { jobs: { first, second } },
      { now, onError },
    );
    await worker.tick();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(
      store.listJobs("one").find((job) => job.id === "job-2"),
    ).toMatchObject({ status: "queued" });
  });

  it("serializes overlapping ticks and waits for an active adapter on stop", async () => {
    const store = await setup();
    store.registerRepository(repo("one"));
    store.enqueueJob("job-1", "one", "scan");
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => {
      release = resolve;
    });
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const scan = vi.fn(async () => {
      notifyStarted();
      await deferred;
    });
    const worker = scheduler(store, { jobs: { scan } }, { now });
    const first = worker.tick();
    const second = worker.tick();
    try {
      await started;
      expect(scan).toHaveBeenCalledOnce();
      let stopped = false;
      const stopping = worker.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      release();
      await Promise.all([first, second, stopping]);
      expect(stopped).toBe(true);
      expect(store.listJobs("one")[0]).toMatchObject({ status: "completed" });
      await worker.tick();
      expect(scan).toHaveBeenCalledOnce();
    } finally {
      release();
      await Promise.allSettled([first, second]);
    }
  });

  it("records unknown adapter outcomes for reconciliation without retrying", async () => {
    const store = await setup();
    store.registerRepository(repo("one"));
    store.enqueueJob("job-1", "one", "scan");
    store.transition("one", 0, "in_progress", intent("intent-1", "sync"));
    const scan = vi.fn(async () => {
      throw new Error("job result unknown");
    });
    const sync = vi.fn(async () => {
      throw new Error("outbox result unknown");
    });
    const onError = vi.fn();
    const worker = scheduler(
      store,
      { jobs: { scan }, outbox: { sync } },
      { now, onError },
    );
    await worker.tick();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(store.listJobs("one")[0]).toMatchObject({ status: "reconciling" });
    expect(store.listOutbox("one")[0]).toMatchObject({ status: "unknown" });
    await worker.tick();
    expect(scan).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();
  });

  it.each(["job", "outbox"] as const)(
    "aborts a stalled %s adapter and preserves an unknown outcome",
    async (kind) => {
      const store = await setup();
      store.registerRepository(repo("one"));
      if (kind === "job") store.enqueueJob("job-1", "one", "stall");
      else
        store.transition("one", 0, "in_progress", intent("intent-1", "stall"));
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
      let signal: AbortSignal | undefined;
      let finish!: () => void;
      const blocked = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const adapter = vi.fn(
        async (_item: unknown, abortSignal: AbortSignal) => {
          signal = abortSignal;
          await blocked;
        },
      );
      const errors = vi.fn();
      const worker = scheduler(
        store,
        kind === "job"
          ? { jobs: { stall: adapter } }
          : { outbox: { stall: adapter } },
        { leaseMs: 10, onError: errors },
      );
      const active = worker.tick();
      await vi.advanceTimersByTimeAsync(1);
      expect(adapter).toHaveBeenCalledOnce();
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      await active;
      expect(signal?.aborted).toBe(true);
      expect(errors).toHaveBeenCalledOnce();
      const row = () =>
        kind === "job" ? store.listJobs("one")[0] : store.listOutbox("one")[0];
      expect(row()).toMatchObject({
        status: kind === "job" ? "reconciling" : "unknown",
      });
      await worker.tick();
      expect(adapter).toHaveBeenCalledOnce();
      await worker.stop();
      finish();
      await Promise.resolve();
      expect(row()).toMatchObject({
        status: kind === "job" ? "reconciling" : "unknown",
      });
    },
  );

  it("rejects invalid timings", async () => {
    const store = await setup();
    expect(() => new DeliveryScheduler(store, {}, { intervalMs: 0 })).toThrow(
      "Invalid scheduler timing",
    );
    expect(() => new DeliveryScheduler(store, {}, { leaseMs: -1 })).toThrow(
      "Invalid scheduler timing",
    );
  });
});
