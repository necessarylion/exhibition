import { SQL } from "bun";

export const MIGRATIONS_DIR = new URL("./migrations", import.meta.url).pathname;

export class Migrator {
  constructor(
    private readonly sql: SQL,
    private readonly dir: string = MIGRATIONS_DIR,
  ) {}

  /** Runs every migration file that has not run yet. Returns their names. */
  async run(): Promise<string[]> {
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
      await tx.unsafe(content);
      await tx`INSERT INTO migrations (name, applied_at) VALUES (${name}, ${appliedAt})`;
    });
  }
}
