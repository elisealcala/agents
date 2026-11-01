/** Local coordination states do not represent remote delivery or ticket completion. */
export type RepositoryState = "ready" | "in_progress" | "paused";

const allowed: Record<RepositoryState, readonly RepositoryState[]> = {
  ready: ["in_progress", "paused"],
  in_progress: ["ready", "paused"],
  paused: ["ready"],
};

export function reduceRepositoryState(
  current: string,
  next: string,
): RepositoryState {
  if (
    !(current in allowed) ||
    !allowed[current as RepositoryState].includes(next as RepositoryState)
  ) {
    throw new Error("Invalid repository transition");
  }
  return next as RepositoryState;
}
