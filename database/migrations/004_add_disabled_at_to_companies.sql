-- An admin can disable a company. Its users cannot log in while this is set.
ALTER TABLE companies ADD COLUMN disabled_at TEXT;
