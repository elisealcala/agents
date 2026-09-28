/**
 * Defaults that more than one module must agree on.
 *
 * Each value below was previously written as the same literal in two places.
 * They live here so the fixed and adaptive paths cannot drift apart: changing
 * one of these changes both, which is the intent (DEC-022).
 */

/**
 * How long `watch` sleeps between inbox scans, in milliseconds.
 *
 * Shared by the fixed and adaptive pipelines. Polling rather than filesystem
 * events keeps behavior identical across platforms and network mounts.
 */
export const DEFAULT_POLL_INTERVAL_MS = 1_000;

/**
 * How many times a file is classified before it is audited as failed.
 *
 * Shared by the fixed and adaptive classifiers. A retry sends a fresh request
 * and carries no history from the rejected attempt, so this only recovers from
 * a malformed response, never from a model that keeps refusing.
 */
export const DEFAULT_CLASSIFICATION_ATTEMPTS = 2;
