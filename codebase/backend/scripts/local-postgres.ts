// Dev-only: a real PostgreSQL server from the `embedded-postgres` npm package.
// Lets you run the app and tests on a laptop without Docker or a system
// Postgres. Prod/CI use a normal Postgres (compose service / Railway / GH service).
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";

const port = Number(process.env.PG_PORT ?? 54329);
const pg = new EmbeddedPostgres({
  databaseDir: path.resolve("data/pg"),
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
});

await pg.initialise().catch(() => {}); // no-op if already initialised
await pg.start();
try { await pg.createDatabase("hypereel"); } catch { /* exists */ }
console.log(`embedded postgres listening: postgresql://postgres:postgres@localhost:${port}/hypereel`);
console.log("Press Ctrl+C to stop.");
const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
