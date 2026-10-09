import { SQL } from "bun";

export const MIGRATIONS_DIR = new URL("./migrations", import.meta.url).pathname;

/** Any fixed number. Every server of this app asks PostgreSQL for the same lock. */
const MIGRATION_LOCK_ID = 7_201_511;

export class Migrator {
  constructor(
    private readonly sql: SQL,
    private readonly dir: string = MIGRATIONS_DIR,
  ) {}

  /**
   * Runs every migration file that has not run yet. Returns their names.
   * On PostgreSQL only one server migrates at a time. A second server that starts at the
   * same moment waits here, and then finds nothing left to do.
   */
  async run(): Promise<string[]> {
    if (this.sql.options.adapter !== "postgres") {
      return this.migrate();
    }
    // The lock belongs to one connection, so that connection is kept until the end.
    const connection = await this.sql.reserve();
    try {
      await connection`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;
      return await this.migrate();
    } finally {
      await connection`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
      connection.release();
    }
  }

  private async migrate(): Promise<string[]> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `;
    const rows: { name: string }[] = await this.sql`SELECT name FROM migrations`;
    const applied = new Set<string>();
    for (const row of rows) {
      applied.add(row.name);
    }

    const files = await Array.fromAsync(new Bun.Glob("*.sql").scan(this.dir));
    files.sort();

    const ran: string[] = [];
    for (const name of files) {
      if (applied.has(name)) {
        continue;
      }
      await this.apply(name);
      ran.push(name);
    }
    return ran;
  }

  private async apply(name: string): Promise<void> {
    const content = await Bun.file(`${this.dir}/${name}`).text();
    const appliedAt = new Date().toISOString();
    // One transaction per file. A failed file leaves nothing behind.
    await this.sql.begin(async (tx) => {
      for (const statement of this.splitStatements(content)) {
        await tx.unsafe(statement);
      }
      await tx`INSERT INTO migrations (name, applied_at) VALUES (${name}, ${appliedAt})`;
    });
  }

  /**
   * Each statement runs alone. When a whole file is sent in one call, the SQLite driver
   * of Bun skips the statements after an ALTER TABLE and reports no error.
   */
  // ponytail: this splits on ";". A migration must not have ";" inside a text value.
  // Use a real SQL parser if a migration ever needs that.
  private splitStatements(content: string): string[] {
    const statements: string[] = [];
    for (const part of content.replace(/^\s*--.*$/gm, "").split(";")) {
      if (part.trim() !== "") {
        statements.push(part.trim());
      }
    }
    return statements;
  }
}
