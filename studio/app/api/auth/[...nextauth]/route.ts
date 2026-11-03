import { handlers } from "@/auth";
import { isHostedMode, isLoginConfigured } from "@/lib/manager-mode";

function unavailable(): Response {
  return Response.json(
    { error: "Sign-in is not configured." },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}
export const GET: typeof handlers.GET = (request) => {
  if (isHostedMode() && !isLoginConfigured())
    return Promise.resolve(unavailable());
  return handlers.GET(request);
};
export const POST: typeof handlers.POST = (request) => {
  if (isHostedMode() && !isLoginConfigured())
    return Promise.resolve(unavailable());
  return handlers.POST(request);
};
