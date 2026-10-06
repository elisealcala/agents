"use client";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "project-manager/server";

export const { TRPCProvider: ProjectTRPCProvider, useTRPC: useProjectTRPC } =
  createTRPCContext<AppRouter>();

export function makeProjectClient(url: string) {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url })] });
}

type Outputs = inferRouterOutputs<AppRouter>;
export type ProjectRecord = Outputs["projects"]["get"];
export type CandidateRecord = Outputs["reviews"]["list"][number];
export type EvidenceRecord = CandidateRecord["evidence"];
export type RunRecord = Outputs["runs"]["get"];
export type EvaluationRecord = Outputs["evaluations"]["get"];
