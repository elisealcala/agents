"use client";

import { useEffect, useState } from "react";

type Status = {
  configured: boolean;
  hasBackup: boolean;
  latest: { state: "ok" | "error"; at: string } | null;
  next: number | null;
};
export function BackupStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void fetch("/api/manager-backup", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Unavailable");
          return response.json() as Promise<Status>;
        })
        .then((result) => {
          setStatus(result);
          setFailed(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);
  let message = "Checking backups…";
  if (failed) message = "Backup status is unavailable.";
  else if (status && !status.configured)
    message = "Backups are not configured.";
  else if (status?.latest?.state === "error")
    message = "The latest backup failed. Check the connection.";
  else if (status && status.next === null)
    message = "A backup is not scheduled.";
  else if (status?.latest?.state === "ok")
    message = `Last verified backup: ${new Date(status.latest.at).toLocaleString()}.`;
  else if (status?.configured) message = "Waiting for the first backup.";
  return (
    <aside aria-live="polite" className="px-3 text-sm">
      {message}
      {status?.hasBackup && (
        <>
          {" "}
          <a href="/api/manager-backup/latest" className="underline">
            Download backup
          </a>
        </>
      )}
    </aside>
  );
}
