/** Local project aggregate; child models remain shared during this extraction. */
import type {
  ApprovedFact,
  Candidate,
  Conversation,
  Note,
  Review,
} from "../application/contracts.ts";

export type Project = {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  notes: Note[];
  candidates: Candidate[];
  approved: ApprovedFact[];
  history: ApprovedFact[];
  reviews: Review[];
  conversations: Conversation[];
};

export const PROJECT_NAME_MAX_LENGTH = 200;

export function normalizeProjectName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > PROJECT_NAME_MAX_LENGTH)
    throw new Error(
      `Project name must contain between 1 and ${PROJECT_NAME_MAX_LENGTH} characters`,
    );
  return normalized;
}

/** ID/time are supplied by the caller; direct-store callers retain their names. */
export function createProject(input: {
  id: string;
  name: string;
  createdAt: string;
}): Project {
  return {
    id: input.id,
    name: input.name,
    revision: 0,
    createdAt: input.createdAt,
    notes: [],
    candidates: [],
    approved: [],
    history: [],
    reviews: [],
    conversations: [],
  };
}
