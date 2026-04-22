import { Hono } from 'hono'
import type { Env } from '../types'

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

boxes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const box = await c.env.DB.prepare('SELECT * FROM boxes WHERE id = ?').bind(id).first()
  if (!box) return c.json({ error: 'Box not found' }, 404)

  const items = await c.env.DB.prepare(
    'SELECT * FROM items WHERE box_id = ? ORDER BY name ASC'
  ).bind(id).all()

  return c.json({ ...box, items: items.results })
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
