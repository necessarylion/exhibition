import { SQL } from "bun";
import { singleton } from "tsyringe";

@singleton()
export class HealthRepository {
  constructor(private readonly sql: SQL) {}

  /** Throws when the database does not answer. */
  async ping(): Promise<void> {
    await this.sql`SELECT 1`;
  }
}
