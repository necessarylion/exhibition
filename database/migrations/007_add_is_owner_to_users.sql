-- The owner is the main user of a company. The owner cannot be removed.
-- 1 means owner, 0 means not. INTEGER works the same on SQLite and PostgreSQL.
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
