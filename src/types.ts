export interface Env {
  DB: D1Database
  PHOTOS: R2Bucket
}

export interface Box {
  id: string
  label: string
  parent_id: string | null
  description: string | null
  photo_url: string | null
  created_at: number
}

export interface Item {
  id: string
  name: string
  description: string | null
  quantity: number
  box_id: string | null
  photo_url: string | null
  tags: string | null
  created_at: number
  updated_at: number
}

export interface Checkout {
  id: string
  item_id: string
  quantity: number
  reason: string | null
  checked_out_at: number
  returned_at: number | null
  returned_quantity: number | null
}

export interface Token {
  id: string
  name: string
  token_hash: string
  created_at: number
  revoked_at: number | null
}
