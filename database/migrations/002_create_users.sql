CREATE TABLE users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies (id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX users_company_id_index ON users (company_id);
