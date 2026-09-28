/**
 * The one interface every provider adapter implements.
 *
 * A completion is a single user message carrying instructions and input
 * together: there is no system message and no conversation history, and a
 * retry sends a fresh request rather than continuing a thread.
 */
import type { Provider } from "../config.ts";

/** A configured model, identified by provider and model id. */
export type ModelClient = {
  provider: Provider;
  model: string;
  complete(prompt: string): Promise<string>;
};
