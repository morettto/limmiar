import { describe, it, expect } from 'vitest'
import QRCode from 'qrcode'

describe('qrcode in jsdom', () => {
  it('generates a data url', async () => {
    const url = await QRCode.toDataURL('hello')
    expect(url.startsWith('data:image')).toBe(true)
  })
})
