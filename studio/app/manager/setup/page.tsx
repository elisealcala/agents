import Link from "next/link";
import { isHostedMode } from "@/lib/manager-mode";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";
export default function ManagerSetupPage() {
  if (!isHostedMode() || process.env.MANAGER_IMPORT_ENABLED !== "true")
    return (
      <main className="p-8">
        <h1>Setup unavailable</h1>
      </main>
    );
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Restore manager backup</h1>
      <p className="mt-3 max-w-2xl">
        Choose the paired backup prepared for this manager. Keep the original
        backups until you have checked your projects and sources.
      </p>
      <ImportForm />
      <Link className="mt-4 inline-block underline" href="/manager">
        Open manager
      </Link>
    </main>
  );
}
