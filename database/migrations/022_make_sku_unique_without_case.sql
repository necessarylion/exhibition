-- The app compares SKUs without case. The index did not, so "ab-1" and "AB-1" could both
-- be saved at the same moment. Old data can have such a pair: the oldest item keeps its SKU,
-- each later one gets a part of its id at the end. The owner can change it.
UPDATE items SET sku = sku || '-' || SUBSTR(id, 1, 8)
WHERE sku IS NOT NULL AND EXISTS (
  SELECT 1 FROM items older
  WHERE older.company_id = items.company_id AND LOWER(older.sku) = LOWER(items.sku)
    AND (older.created_at < items.created_at
      OR (older.created_at = items.created_at AND older.id < items.id))
);

DROP INDEX items_company_sku_index;

CREATE UNIQUE INDEX items_company_sku_index ON items (company_id, LOWER(sku)) WHERE sku IS NOT NULL;
