import { Hono } from 'hono'
import type { Env } from '../types'

const checkouts = new Hono<{ Bindings: Env }>()

checkouts.get('/', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT c.*, i.name as item_name, i.box_id
    FROM checkouts c
    JOIN items i ON i.id = c.item_id
    WHERE c.returned_at IS NULL
    ORDER BY c.checked_out_at DESC
  `).all()
  return c.json(rows.results)
})

checkouts.post('/', async (c) => {
  const body = await c.req.json<{
    item_id: string
    quantity?: number
    reason?: string | null
  }>()

  if (!body.item_id) {
    return c.json({ error: 'item_id is required' }, 400)
  }

  const item = await c.env.DB.prepare('SELECT id, quantity FROM items WHERE id = ?').bind(body.item_id).first<{ id: string; quantity: number }>()
  if (!item) return c.json({ error: 'Item not found' }, 404)

  const quantity = body.quantity ?? 1
  if (quantity < 1) return c.json({ error: 'quantity must be at least 1' }, 400)
  if (quantity > item.quantity) return c.json({ error: 'Not enough stock' }, 409)

  const id = crypto.randomUUID()
  const now = Date.now()

  await c.env.DB.prepare(
    'INSERT INTO checkouts (id, item_id, quantity, reason, checked_out_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, body.item_id, quantity, body.reason ?? null, now).run()

  await c.env.DB.prepare(
    'UPDATE items SET quantity = quantity - ?, updated_at = ? WHERE id = ?'
  ).bind(quantity, now, body.item_id).run()

  const checkout = await c.env.DB.prepare('SELECT * FROM checkouts WHERE id = ?').bind(id).first()
  return c.json(checkout, 201)
})

checkouts.put('/:id/consume', async (c) => {
  const id = c.req.param('id')

  const checkout = await c.env.DB.prepare(
    'SELECT * FROM checkouts WHERE id = ? AND returned_at IS NULL'
  ).bind(id).first<{ id: string; item_id: string; quantity: number }>()

  if (!checkout) return c.json({ error: 'Checkout not found or already returned' }, 404)

  const now = Date.now()
  // Mark closed but do not restore quantity - items were permanently consumed
  await c.env.DB.prepare(
    'UPDATE checkouts SET returned_at = ?, returned_quantity = 0 WHERE id = ?'
  ).bind(now, id).run()

  const updated = await c.env.DB.prepare('SELECT * FROM checkouts WHERE id = ?').bind(id).first()
  return c.json(updated)
})

checkouts.put('/:id/return', async (c) => {
  const id = c.req.param('id')
  const body: { returned_quantity?: number } = await c.req.json().catch(() => ({}))

  const checkout = await c.env.DB.prepare(
    'SELECT * FROM checkouts WHERE id = ? AND returned_at IS NULL'
  ).bind(id).first<{ id: string; item_id: string; quantity: number }>()

  if (!checkout) return c.json({ error: 'Checkout not found or already returned' }, 404)

  const returnedQty = body.returned_quantity ?? checkout.quantity
  if (returnedQty < 1 || returnedQty > checkout.quantity) {
    return c.json({ error: 'Invalid returned_quantity' }, 400)
  }

  const now = Date.now()

  await c.env.DB.prepare(
    'UPDATE checkouts SET returned_at = ?, returned_quantity = ? WHERE id = ?'
  ).bind(now, returnedQty, id).run()

  await c.env.DB.prepare(
    'UPDATE items SET quantity = quantity + ?, updated_at = ? WHERE id = ?'
  ).bind(returnedQty, now, checkout.item_id).run()

  const updated = await c.env.DB.prepare('SELECT * FROM checkouts WHERE id = ?').bind(id).first()
  return c.json(updated)
})

export default checkouts
