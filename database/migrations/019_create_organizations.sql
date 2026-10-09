-- An organization group, like "True Group". Only customer companies are in a group.
-- The companies of one group share their items with each other for free.
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- The name in lower case with no spaces at the ends. Two groups cannot share it.
  name_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX organizations_name_key_index ON organizations (name_key);

-- A company is in at most one group. Deleting a group only takes its companies out.
ALTER TABLE companies ADD COLUMN organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL;

CREATE INDEX companies_organization_id_index ON companies (organization_id);
