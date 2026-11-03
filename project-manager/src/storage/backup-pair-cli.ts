/** One-time local cutover helper; the original services must remain stopped. */
import { createBackupPair } from "./backup-pair.ts";
const [managerPath, evidencePath, outputDirectory, ...extra] =
  process.argv.slice(2);
if (!managerPath || !evidencePath || !outputDirectory || extra.length !== 0)
  throw new Error(
    "Usage: backup-pair-cli <manager.sqlite> <evidence.sqlite> <new-backup-directory>",
  );
await createBackupPair({ managerPath, evidencePath, outputDirectory });
process.stdout.write(
  "Complete original backups and a staged manager copy were created. Keep both original services stopped.\n",
);
