import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { authMiddleware } from './middleware/auth'
import boxes from './routes/boxes'
import items from './routes/items'
import checkouts from './routes/checkouts'
import photos from './routes/photos'
import tokens from './routes/tokens'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: [
    'https://warehouse-kwasek.pages.dev',
    'https://warehouse.kwasek.org',
    'http://localhost:5173',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Type'],
  maxAge: 86400,
}))

// Photos: GET is public, POST is protected (handled inside the router)
app.route('/photos', photos)

// All other routes require auth
app.use('/tokens/*', authMiddleware)
app.use('/boxes/*', authMiddleware)
app.use('/items/*', authMiddleware)
app.use('/checkouts/*', authMiddleware)

app.route('/tokens', tokens)
app.route('/boxes', boxes)
app.route('/items', items)
app.route('/checkouts', checkouts)

export default app
