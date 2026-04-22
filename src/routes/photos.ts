import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware } from '../middleware/auth'

const photos = new Hono<{ Bindings: Env }>()

photos.post('/', authMiddleware, async (c) => {
  const contentType = c.req.header('Content-Type') ?? 'application/octet-stream'
  const ext = contentType.split('/')[1]?.split(';')[0] ?? 'bin'
  const key = `${crypto.randomUUID()}.${ext}`

  const body = await c.req.arrayBuffer()
  if (!body.byteLength) {
    return c.json({ error: 'Empty body' }, 400)
  }

  await c.env.PHOTOS.put(key, body, {
    httpMetadata: { contentType },
  })

  return c.json({ key, url: `/photos/${key}` }, 201)
})

photos.get('/:key', async (c) => {
  const key = c.req.param('key')
  const object = await c.env.PHOTOS.get(key)

  if (!object) return c.json({ error: 'Not found' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')

  return new Response(object.body, { headers })
})

export default photos
