import { isHostedMode, isLoginConfigured } from "@/lib/manager-mode";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import Link from "next/link";
import { BackupStatus } from "@/components/manager/backup-status";

export const dynamic = "force-dynamic";
export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isHostedMode()) {
    const owner = process.env.MANAGER_OWNER_ID;
    if (!isLoginConfigured()) {
      return (
        <main className="p-8">
          <h1>Manager setup unavailable</h1>
          <p>Sign-in is not configured. Contact the administrator.</p>
        </main>
      );
    }
    const session = await auth();
    if (!session?.user?.id || session.user.id !== owner) redirect("/login");
  }
  if (isHostedMode())
    return (
      <>
        <form
          className="self-end p-3"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="rounded border px-3 py-2 text-sm" type="submit">
            Sign out
          </button>
        </form>
        {process.env.MANAGER_IMPORT_ENABLED === "true" && (
          <Link className="px-3 text-sm underline" href="/manager/setup">
            Restore backup
          </Link>
        )}
        <BackupStatus />
        {children}
      </>
    );
  return children;
}
