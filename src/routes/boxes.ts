import { Hono } from 'hono'
import type { Env, BoxGrid, BoxSlot } from '../types'

const boxes = new Hono<{ Bindings: Env }>()

boxes.get('/', async (c) => {
  const parentId = c.req.query('parent_id')
  const query = parentId === 'null'
    ? 'SELECT * FROM boxes WHERE parent_id IS NULL ORDER BY label ASC'
    : parentId
      ? 'SELECT * FROM boxes WHERE parent_id = ? ORDER BY label ASC'
      : 'SELECT * FROM boxes ORDER BY label ASC'

  const stmt = parentId && parentId !== 'null'
    ? c.env.DB.prepare(query).bind(parentId)
    : c.env.DB.prepare(query)

  const rows = await stmt.all()
  return c.json(rows.results)
})

boxes.post('/', async (c) => {
  const body = await c.req.json<{
    label: string
    parent_id?: string | null
    description?: string | null
    photo_url?: string | null
  }>()

  if (!body.label?.trim()) {
    return c.json({ error: 'label is required' }, 400)
  }

  const id = crypto.randomUUID()
  const now = Date.now()

  await c.env.DB.prepare(
    'INSERT INTO boxes (id, label, parent_id, description, photo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.label.trim(), body.parent_id ?? null, body.description ?? null, body.photo_url ?? null, now).run()

  const box = await c.env.DB.prepare('SELECT * FROM boxes WHERE id = ?').bind(id).first()
  return c.json(box, 201)
})

boxes.get('/:id/grid', async (c) => {
  const id = c.req.param('id')
  const box = await c.env.DB.prepare('SELECT id FROM boxes WHERE id = ?').bind(id).first()
  if (!box) return c.json({ error: 'Box not found' }, 404)

  const grid = await c.env.DB.prepare('SELECT * FROM box_grids WHERE box_id = ?').bind(id).first()
  if (!grid) return c.json({ error: 'No grid configured for this box' }, 404)
  return c.json(grid)
})

boxes.put('/:id/grid', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<Omit<BoxGrid, 'box_id'>>()

  if (!body.type_id || !body.width_mm || !body.depth_mm) {
    return c.json({ error: 'type_id, width_mm and depth_mm are required' }, 400)
  }

  const box = await c.env.DB.prepare('SELECT id FROM boxes WHERE id = ?').bind(id).first()
  if (!box) return c.json({ error: 'Box not found' }, 404)

  const typeExists = await c.env.DB.prepare(
    'SELECT id FROM grid_surface_types WHERE id = ?'
  ).bind(body.type_id).first()
  if (!typeExists) return c.json({ error: 'Invalid type_id' }, 400)

  await c.env.DB.prepare(`
    INSERT INTO box_grids (box_id, type_id, width_mm, depth_mm, height_mm, margin_mm, pitch_mm)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(box_id) DO UPDATE SET
      type_id   = excluded.type_id,
      width_mm  = excluded.width_mm,
      depth_mm  = excluded.depth_mm,
      height_mm = excluded.height_mm,
      margin_mm = excluded.margin_mm,
      pitch_mm  = excluded.pitch_mm
  `).bind(
    id,
    body.type_id,
    body.width_mm,
    body.depth_mm,
    body.height_mm ?? null,
    body.margin_mm ?? null,
    body.pitch_mm ?? 10
  ).run()

  const grid = await c.env.DB.prepare('SELECT * FROM box_grids WHERE box_id = ?').bind(id).first()
  return c.json(grid)
})

boxes.delete('/:id/grid', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.DB.prepare('DELETE FROM box_grids WHERE box_id = ?').bind(id).run()
  if (result.meta.changes === 0) return c.json({ error: 'No grid configured for this box' }, 404)
  return c.body(null, 204)
})

boxes.get('/:id/slot', async (c) => {
  const id = c.req.param('id')
  const box = await c.env.DB.prepare('SELECT id FROM boxes WHERE id = ?').bind(id).first()
  if (!box) return c.json({ error: 'Box not found' }, 404)

  const slot = await c.env.DB.prepare('SELECT * FROM box_slots WHERE box_id = ?').bind(id).first()
  if (!slot) return c.json({ error: 'No slot assigned to this box' }, 404)
  return c.json(slot)
})

boxes.put('/:id/slot', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<Omit<BoxSlot, 'box_id'>>()

  if (body.x === undefined || body.y === undefined || !body.w || !body.d) {
    return c.json({ error: 'x, y, w and d are required' }, 400)
  }
  if (body.w < 1 || body.d < 1) return c.json({ error: 'w and d must be at least 1' }, 400)

  const box = await c.env.DB.prepare(
    'SELECT id, parent_id FROM boxes WHERE id = ?'
  ).bind(id).first<{ id: string; parent_id: string | null }>()
  if (!box) return c.json({ error: 'Box not found' }, 404)
  if (!box.parent_id) return c.json({ error: 'Box has no parent - cannot assign slot' }, 400)

  const parentGrid = await c.env.DB.prepare(
    'SELECT * FROM box_grids WHERE box_id = ?'
  ).bind(box.parent_id).first<BoxGrid>()
  if (!parentGrid) return c.json({ error: 'Parent box has no grid configured' }, 400)

  const usableDepth = parentGrid.margin_mm !== null
    ? parentGrid.depth_mm - parentGrid.margin_mm
    : parentGrid.depth_mm
  const maxX = Math.floor(parentGrid.width_mm / parentGrid.pitch_mm)
  const maxY = Math.floor(usableDepth / parentGrid.pitch_mm)

  if (body.x + body.w > maxX) return c.json({ error: `Slot exceeds grid width (max ${maxX} in X)` }, 400)
  if (body.y + body.d > maxY) return c.json({ error: `Slot exceeds grid depth (max ${maxY} in Y)` }, 400)

  const overlap = await c.env.DB.prepare(`
    SELECT bs.box_id FROM box_slots bs
    JOIN boxes b ON b.id = bs.box_id
    WHERE b.parent_id = ?
      AND bs.box_id != ?
      AND bs.x < ? AND bs.x + bs.w > ?
      AND bs.y < ? AND bs.y + bs.d > ?
  `).bind(
    box.parent_id, id,
    body.x + body.w, body.x,
    body.y + body.d, body.y
  ).first()
  if (overlap) return c.json({ error: 'Slot overlaps with an existing toner' }, 409)

  await c.env.DB.prepare(`
    INSERT INTO box_slots (box_id, x, y, w, d) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(box_id) DO UPDATE SET x = excluded.x, y = excluded.y, w = excluded.w, d = excluded.d
  `).bind(id, body.x, body.y, body.w, body.d).run()

  const slot = await c.env.DB.prepare('SELECT * FROM box_slots WHERE box_id = ?').bind(id).first()
  return c.json(slot)
})

boxes.delete('/:id/slot', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.DB.prepare('DELETE FROM box_slots WHERE box_id = ?').bind(id).run()
  if (result.meta.changes === 0) return c.json({ error: 'No slot assigned to this box' }, 404)
  return c.body(null, 204)
})

boxes.get('/:id/layout', async (c) => {
  const id = c.req.param('id')
  const box = await c.env.DB.prepare('SELECT * FROM boxes WHERE id = ?').bind(id).first()
  if (!box) return c.json({ error: 'Box not found' }, 404)

  const grid = await c.env.DB.prepare('SELECT * FROM box_grids WHERE box_id = ?').bind(id).first()
  if (!grid) return c.json({ error: 'No grid configured for this box' }, 404)

  const toners = await c.env.DB.prepare(`
    SELECT b.*, bs.x, bs.y, bs.w, bs.d
    FROM boxes b
    JOIN box_slots bs ON bs.box_id = b.id
    WHERE b.parent_id = ?
    ORDER BY bs.y ASC, bs.x ASC
  `).bind(id).all()

  return c.json({ ...box, grid, toners: toners.results })
})

boxes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const box = await c.env.DB.prepare('SELECT * FROM boxes WHERE id = ?').bind(id).first()
  if (!box) return c.json({ error: 'Box not found' }, 404)

  const [items, grid, slot] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM items WHERE box_id = ? ORDER BY name ASC').bind(id).all(),
    c.env.DB.prepare('SELECT * FROM box_grids WHERE box_id = ?').bind(id).first(),
    c.env.DB.prepare('SELECT * FROM box_slots WHERE box_id = ?').bind(id).first(),
  ])

  return c.json({ ...box, items: items.results, grid: grid ?? null, slot: slot ?? null })
})

boxes.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    label?: string
    parent_id?: string | null
    description?: string | null
    photo_url?: string | null
  }>()

  const existing = await c.env.DB.prepare('SELECT id FROM boxes WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'Box not found' }, 404)

  await c.env.DB.prepare(`
    UPDATE boxes SET
      label = COALESCE(?, label),
      parent_id = CASE WHEN ? THEN ? ELSE parent_id END,
      description = CASE WHEN ? THEN ? ELSE description END,
      photo_url = CASE WHEN ? THEN ? ELSE photo_url END
    WHERE id = ?
  `).bind(
    body.label?.trim() ?? null,
    'parent_id' in body ? 1 : 0, body.parent_id ?? null,
    'description' in body ? 1 : 0, body.description ?? null,
    'photo_url' in body ? 1 : 0, body.photo_url ?? null,
    id
  ).run()

  const box = await c.env.DB.prepare('SELECT * FROM boxes WHERE id = ?').bind(id).first()
  return c.json(box)
})

boxes.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const itemCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM items WHERE box_id = ?'
  ).bind(id).first<{ count: number }>()

  if (itemCount && itemCount.count > 0) {
    return c.json({ error: 'Box is not empty' }, 409)
  }

  const result = await c.env.DB.prepare('DELETE FROM boxes WHERE id = ?').bind(id).run()
  if (result.meta.changes === 0) return c.json({ error: 'Box not found' }, 404)
  return c.body(null, 204)
})

export default boxes
