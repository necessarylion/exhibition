import { SQL } from "bun";

/**
 * Opens the database. Every part of the app and every test opens it here.
 * SQLite checks foreign keys only when it is told to, on each connection. PostgreSQL
 * always checks them. With this, development and tests act like production.
 */
export async function openDatabase(url: string): Promise<SQL> {
  const sql = new SQL(url);
  if (sql.options.adapter === "sqlite") {
    await sql`PRAGMA foreign_keys = ON`;
  }
  return sql;
}
