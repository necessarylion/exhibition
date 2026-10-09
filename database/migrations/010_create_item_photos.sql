-- An item can have many photos. The photo at the lowest position is the cover.
CREATE TABLE item_photos (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  -- The file name in the uploads folder.
  file TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX item_photos_item_id_index ON item_photos (item_id);

-- Move the one photo of every item to the new table. An item had at most one photo,
-- so the id of the item is free to use as the id of its photo row.
INSERT INTO item_photos (id, item_id, file, position, created_at)
SELECT id, id, photo, 0, created_at FROM items WHERE photo IS NOT NULL;

ALTER TABLE items DROP COLUMN photo;
