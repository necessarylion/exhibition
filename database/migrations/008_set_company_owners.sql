-- For companies that exist already, the first user becomes the owner.
UPDATE users SET is_owner = 1
WHERE NOT EXISTS (SELECT 1 FROM users owner WHERE owner.company_id = users.company_id AND owner.is_owner = 1)
  AND created_at = (
    SELECT MIN(first.created_at) FROM users first WHERE first.company_id = users.company_id
  );

-- A company has at most one owner.
CREATE UNIQUE INDEX users_one_owner_index ON users (company_id) WHERE is_owner = 1;
