import { signIn } from "@/auth";

export const dynamic = "force-dynamic";
export default function Login() {
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Project manager</h1>
      <p className="my-4">Sign in with the authorized GitHub account.</p>
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/manager" });
        }}
      >
        <button
          className="rounded bg-foreground px-4 py-2 text-background"
          type="submit"
        >
          Sign in with GitHub
        </button>
      </form>
    </main>
  );
}
