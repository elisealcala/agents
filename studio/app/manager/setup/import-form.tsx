"use client";

import { useState, type FormEvent } from "react";

export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size > 8 * 1024 * 1024) {
      setMessage("This backup is too large to import here.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/manager-migration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: file,
      });
      if (!response.ok) {
        const result: unknown = await response.json();
        setMessage(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "Import could not be completed. Retry the same file.",
        );
      } else setMessage("Import completed. You can open the manager now.");
    } catch {
      setMessage("Import status is uncertain. Retry the same file.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-6 grid max-w-lg gap-4">
      <label className="grid gap-2">
        Backup file
        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setMessage("");
          }}
          disabled={busy}
        />
      </label>
      <button
        className="w-fit rounded border px-4 py-2 disabled:opacity-50"
        disabled={!file || busy}
        type="submit"
      >
        {busy ? "Importing…" : "Import backup"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
