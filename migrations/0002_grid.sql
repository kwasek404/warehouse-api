CREATE TABLE IF NOT EXISTS grid_surface_types (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

INSERT OR IGNORE INTO grid_surface_types (id, name) VALUES
  ('drawer',     'Drawer'),
  ('wall_panel', 'Wall Panel');

-- 1:1 with boxes - describes a box that IS a grid surface (drawer, wall panel, ...)
CREATE TABLE IF NOT EXISTS box_grids (
  box_id    TEXT PRIMARY KEY REFERENCES boxes(id) ON DELETE CASCADE,
  type_id   TEXT NOT NULL REFERENCES grid_surface_types(id),
  width_mm  INTEGER NOT NULL,
  depth_mm  INTEGER NOT NULL,
  height_mm INTEGER,       -- NULL for wall_panel (no fixed height)
  margin_mm INTEGER,       -- NULL for wall_panel (no dead zone at back)
  pitch_mm  INTEGER NOT NULL DEFAULT 10
);

-- 1:1 with boxes - describes a box that OCCUPIES a slot in its parent's grid
CREATE TABLE IF NOT EXISTS box_slots (
  box_id TEXT PRIMARY KEY REFERENCES boxes(id) ON DELETE CASCADE,
  x      INTEGER NOT NULL,
  y      INTEGER NOT NULL,
  w      INTEGER NOT NULL DEFAULT 1,
  d      INTEGER NOT NULL DEFAULT 1
);
