import { Hono } from 'hono'
import type { Env } from '../types'

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

const tokens = new Hono<{ Bindings: Env }>()

tokens.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, created_at, revoked_at FROM tokens ORDER BY created_at DESC'
  ).all()
  return c.json(rows.results)
})

tokens.post('/', async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  const token = generateToken()
  const hash = await hashToken(token)
  const id = crypto.randomUUID()
  const now = Date.now()

  await c.env.DB.prepare(
    'INSERT INTO tokens (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)'
  ).bind(id, name.trim(), hash, now).run()

  return c.json({ id, name: name.trim(), token, created_at: now }, 201)
})

tokens.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    'UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'
  ).bind(Date.now(), id).run()

  if (result.meta.changes === 0) {
    return c.json({ error: 'Token not found or already revoked' }, 404)
  }
  return c.body(null, 204)
})

export default tokens
