// Vitest global setup: start an embedded Postgres, apply migrations, expose
// DATABASE_URL to the test workers, and tear it down afterwards.
// In CI the same tests run against a Postgres service container instead
// (TEST_DATABASE_URL set), so this is skipped there.
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";

export default async function setup() {
  let stop = async () => {};
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const port = 54399;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hypereel-pg-"));
    const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("test");
    url = `postgresql://postgres:postgres@localhost:${port}/test`;
    stop = async () => { await pg.stop(); await fs.rm(dir, { recursive: true, force: true }); };
  }
  process.env.DATABASE_URL = url;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
  return stop;
}
