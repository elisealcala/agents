"use client";

import { QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "ingest-classifier/server";

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>();

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

export function makeClient(url: string) {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({ url }),
        false: httpBatchLink({ url }),
      }),
    ],
  });
}
