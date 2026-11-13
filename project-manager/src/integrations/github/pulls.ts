import { fetchInventory } from "./issues";
import type { FetchInventoryOptions, InventoryResult } from "./issues";

export function fetchPullInventory(
  options: FetchInventoryOptions,
): Promise<InventoryResult> {
  return fetchInventory("pull_request", options);
}
