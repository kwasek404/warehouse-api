import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authorization.slice(7)
  const hash = await hashToken(token)

  const row = await c.env.DB.prepare(
    'SELECT id FROM tokens WHERE token_hash = ? AND revoked_at IS NULL'
  ).bind(hash).first()

  if (!row) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})
