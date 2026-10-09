-- Every user belongs to one company. The company type is the role of its users.
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('admin', 'supplier', 'customer')),
  created_at TEXT NOT NULL
);

-- There is only one admin company: the platform itself.
CREATE UNIQUE INDEX companies_one_admin_index ON companies (type) WHERE type = 'admin';
