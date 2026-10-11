import { chmodSync, constants, copyFileSync, lstatSync } from "node:fs";

const BACKUP_MODE = 0o644;

function nextBackupPath(source: string): string {
  const base = `${source}.agent-gates-backup`;
  let path = base;
  let number = 2;
  while (lstatSync(path, { throwIfNoEntry: false })) {
    path = `${base}-${number}`;
    number += 1;
  }
  return path;
}

export function copyAside(source: string): string {
  const backup = nextBackupPath(source);
  copyFileSync(source, backup, constants.COPYFILE_EXCL);
  chmodSync(backup, BACKUP_MODE);
  return backup;
}
