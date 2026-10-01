import { Hono } from 'hono'
import type { Env } from '../types'

const items = new Hono<{ Bindings: Env }>()

items.get('/', async (c) => {
  const q = c.req.query('q')?.trim()
  const boxId = c.req.query('box_id')
  const tagsFilter = c.req.query('tags')?.trim()

  if (q) {
    const conditions: string[] = ['items_fts MATCH ?']
    const params: (string | null)[] = [q]

    if (boxId === 'null') conditions.push('i.box_id IS NULL')
    else if (boxId) { conditions.push('i.box_id = ?'); params.push(boxId) }
    if (tagsFilter) { conditions.push('i.tags LIKE ?'); params.push(`%${tagsFilter}%`) }

    const sql = `SELECT i.* FROM items i JOIN items_fts ON items_fts.rowid = i.rowid WHERE ${conditions.join(' AND ')} ORDER BY rank`
    const rows = await c.env.DB.prepare(sql).bind(...params).all()
    return c.json(rows.results)
  }

  const conditions: string[] = []
  const params: (string | null)[] = []

  if (boxId === 'null') conditions.push('box_id IS NULL')
  else if (boxId) { conditions.push('box_id = ?'); params.push(boxId) }
  if (tagsFilter) { conditions.push('tags LIKE ?'); params.push(`%${tagsFilter}%`) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `SELECT * FROM items ${where} ORDER BY name ASC`
  const stmt = c.env.DB.prepare(sql)
  const rows = await (params.length ? stmt.bind(...params) : stmt).all()
  return c.json(rows.results)
})

items.post('/', async (c) => {
  const body = await c.req.json<{
    name: string
    description?: string | null
    quantity?: number
    box_id?: string | null
    photo_url?: string | null
    tags?: string | null
  }>()

  if (!body.name?.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const now = Date.now()
  const quantity = body.quantity ?? 1

  await c.env.DB.prepare(
    'INSERT INTO items (id, name, description, quantity, box_id, photo_url, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.name.trim(), body.description ?? null, quantity, body.box_id ?? null, body.photo_url ?? null, body.tags ?? null, now, now).run()

  const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first()
  return c.json(item, 201)
})

items.get('/tags', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT tags FROM items WHERE tags IS NOT NULL AND tags != ""'
  ).all<{ tags: string }>()

  const tagSet = new Set<string>()
  for (const row of rows.results) {
    for (const tag of row.tags.split(',')) {
      const t = tag.trim()
      if (t) tagSet.add(t)
    }
  }

  return c.json([...tagSet].sort())
})

items.get('/:id', async (c) => {
  const id = c.req.param('id')
  const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first()
  if (!item) return c.json({ error: 'Item not found' }, 404)

  const checkouts = await c.env.DB.prepare(
    'SELECT * FROM checkouts WHERE item_id = ? AND returned_at IS NULL ORDER BY checked_out_at DESC'
  ).bind(id).all()

  return c.json({ ...item, active_checkouts: checkouts.results })
})

items.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    name?: string
    description?: string | null
    quantity?: number
    box_id?: string | null
    photo_url?: string | null
    tags?: string | null
  }>()

  const existing = await c.env.DB.prepare('SELECT id FROM items WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'Item not found' }, 404)

  const now = Date.now()

  await c.env.DB.prepare(`
    UPDATE items SET
      name = COALESCE(?, name),
      description = CASE WHEN ? THEN ? ELSE description END,
      quantity = COALESCE(?, quantity),
      box_id = CASE WHEN ? THEN ? ELSE box_id END,
      photo_url = CASE WHEN ? THEN ? ELSE photo_url END,
      tags = CASE WHEN ? THEN ? ELSE tags END,
      updated_at = ?
    WHERE id = ?
  `).bind(
    body.name?.trim() ?? null,
    'description' in body ? 1 : 0, body.description ?? null,
    body.quantity ?? null,
    'box_id' in body ? 1 : 0, body.box_id ?? null,
    'photo_url' in body ? 1 : 0, body.photo_url ?? null,
    'tags' in body ? 1 : 0, body.tags ?? null,
    now,
    id
  ).run()

  const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first()
  return c.json(item)
})

items.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const activeCheckout = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM checkouts WHERE item_id = ? AND returned_at IS NULL'
  ).bind(id).first<{ count: number }>()

  if (activeCheckout && activeCheckout.count > 0) {
    return c.json({ error: 'Item has active checkouts' }, 409)
  }

  await c.env.DB.prepare('DELETE FROM checkouts WHERE item_id = ?').bind(id).run()
  const result = await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run()
  if (result.meta.changes === 0) return c.json({ error: 'Item not found' }, 404)
  return c.body(null, 204)
})

export default items
