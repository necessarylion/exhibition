-- More facts about an item. All of them are optional, only the unit has a default.
-- The SKU is the stock code of the company. Two items of one company cannot share it.
ALTER TABLE items ADD COLUMN sku TEXT;
-- The price is for one unit.
ALTER TABLE items ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece'
  CHECK (unit IN ('piece', 'set', 'meter', 'sqm'));
ALTER TABLE items ADD COLUMN width_cm INTEGER;
ALTER TABLE items ADD COLUMN height_cm INTEGER;
ALTER TABLE items ADD COLUMN depth_cm INTEGER;
ALTER TABLE items ADD COLUMN weight_grams INTEGER;
ALTER TABLE items ADD COLUMN color TEXT;
ALTER TABLE items ADD COLUMN material TEXT;
-- NULL means there is no stock limit.
ALTER TABLE items ADD COLUMN stock INTEGER CHECK (stock >= 0);

CREATE UNIQUE INDEX items_company_sku_index ON items (company_id, sku) WHERE sku IS NOT NULL;
