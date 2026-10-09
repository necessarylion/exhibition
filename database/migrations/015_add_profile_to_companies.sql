-- The public profile of a company. Its owner fills it. Empty text means not set.
ALTER TABLE companies ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN address TEXT NOT NULL DEFAULT '';
-- An http or https URL.
ALTER TABLE companies ADD COLUMN website TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN about TEXT NOT NULL DEFAULT '';
