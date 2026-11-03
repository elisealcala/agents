/** No public API: the UI reaches the manager only through its Durable Object binding. */
export { DurableEvidenceObject } from "./evidence-object.ts";
export { DurableManagerObject } from "./manager-object.ts";

export default {
  fetch(): Response {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  },
};
