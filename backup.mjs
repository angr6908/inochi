import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = "/data";
const STAGING = join(DATA_DIR, ".backup");
const HOST = "inochi";
const EXCLUDES = ["web", "inochi.db", "inochi.db-wal", "inochi.db-shm", ".git"].map((entry) => join(DATA_DIR, entry));
const KEEP = ["--keep-daily", "7", "--keep-weekly", "4", "--keep-monthly", "6"];
const AUTH = process.env.RESTIC_PASSWORD ? [] : ["--insecure-no-password"];

function restic(args, stdio = "inherit") {
  execFileSync("restic", [...AUTH, ...args], { stdio });
}

function ensureRepository() {
  try {
    restic(["cat", "config"], "ignore");
  } catch {
    restic(["init"]);
  }
}

function snapshotDatabase() {
  rmSync(STAGING, { recursive: true, force: true });
  mkdirSync(STAGING, { recursive: true });
  const db = new DatabaseSync(join(DATA_DIR, "inochi.db"), { timeout: 10000 });
  try {
    db.prepare("VACUUM INTO ?").run(join(STAGING, "inochi.db"));
  } finally {
    db.close();
  }
}

try {
  ensureRepository();
  restic(["unlock"], "ignore");
  snapshotDatabase();
  restic(["backup", "--host", HOST, ...EXCLUDES.flatMap((path) => ["--exclude", path]), DATA_DIR]);
  restic(["forget", "--host", HOST, ...KEEP, "--prune"]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(STAGING, { recursive: true, force: true });
}
