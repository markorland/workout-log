import { afterEach, describe, expect, it } from 'vitest'
import { newId } from './db'

const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')

describe('newId', () => {
  afterEach(() => {
    if (original) Object.defineProperty(crypto, 'randomUUID', original)
    else delete (crypto as { randomUUID?: unknown }).randomUUID
  })

  it('makes v4 UUIDs even where crypto.randomUUID is missing (plain-HTTP pages)', () => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    const ids = new Set(Array.from({ length: 200 }, () => newId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
