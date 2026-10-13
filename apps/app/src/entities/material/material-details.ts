import type { MaterialType } from './material-crypto'

export interface MaterialDetails { title: string; authors: string }

const DC = 'http://purl.org/dc/elements/1.1/'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const XMP_START = '<x:xmpmeta'
const XMP_END = '</x:xmpmeta>'
const NO_DETAILS: MaterialDetails = { title: '', authors: '' }
const ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 }

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

// raw has one char per byte (index == offset); string bytes are still read from `bytes`, since windows-1252 remaps 0x80-0x9F.
function literal(raw: string, bytes: Uint8Array, start: number): Uint8Array {
  const out: number[] = []
  let depth = 1
  for (let i = start + 1; i < bytes.length; i++) {
    const char = raw[i]
    if (char === '(') depth++
    if (char === ')' && --depth === 0) break
    if (char !== '\\') { out.push(bytes[i]); continue }
    const octal = /^[0-7]{1,3}/.exec(raw.slice(i + 1, i + 4))?.[0]
    if (octal) { out.push(parseInt(octal, 8)); i += octal.length }
    else if (++i < bytes.length) out.push(ESCAPES[raw[i]] ?? bytes[i])
  }
  return Uint8Array.from(out)
}

function hex(raw: string, start: number): Uint8Array {
  const digits = /^[\da-f\s]*/i.exec(raw.slice(start + 1))![0].replace(/\s/g, '')
  return Uint8Array.from(digits.padEnd(Math.ceil(digits.length / 2) * 2, '0').match(/../g) ?? [], pair => parseInt(pair, 16))
}

function decodeText(bytes: Uint8Array): string {
  const head = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2]
  const encoding = head >> 8 === 0xfeff ? 'utf-16be' : head === 0xefbbbf ? 'utf-8' : 'windows-1252'
  return clean(new TextDecoder(encoding).decode(bytes))
}

// ponytail: an Info dictionary inside a compressed object stream is not found; the filename fills in.
function info(raw: string, bytes: Uint8Array): MaterialDetails {
  const reference = [...raw.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R/g)].at(-1)
  if (!reference || raw.includes('/Encrypt')) return NO_DETAILS
  const object = [...raw.matchAll(new RegExp(`(?<!\\d)${reference[1]}\\s+${reference[2]}\\s+obj([\\s\\S]*?)endobj`, 'dg'))].at(-1)
  if (!object) return NO_DETAILS
  const field = (key: string) => {
    const found = new RegExp(`/${key}\\s*(?=\\(|<[^<])`).exec(object[1])
    if (!found) return ''
    const at = object.indices![1]![0] + found.index + found[0].length
    return decodeText(raw[at] === '(' ? literal(raw, bytes, at) : hex(raw, at))
  }
  return { title: field('Title'), authors: field('Author') }
}

function xmp(raw: string, bytes: Uint8Array): MaterialDetails {
  const start = raw.lastIndexOf(XMP_START)
  const end = raw.indexOf(XMP_END, start)
  if (start < 0 || end < 0) return NO_DETAILS
  const packet = new DOMParser().parseFromString(new TextDecoder().decode(bytes.subarray(start, end + XMP_END.length)), 'application/xml')
  const values = (name: string) => Array.from(packet.getElementsByTagNameNS(DC, name)[0]?.getElementsByTagNameNS(RDF, 'li') ?? [], item => clean(item.textContent)).filter(Boolean)
  return { title: values('title')[0] ?? '', authors: values('creator').join('; ') }
}

// Runs in the browser before encryption; the document never leaves the device.
export function readMaterialDetails(filename: string, type: MaterialType, bytes: Uint8Array): MaterialDetails {
  const fallback = filename.replace(/\.(pdf|txt)$/i, '').replace(/[_\-\s]+/g, ' ').trim()
  if (type === 'txt') return { title: fallback, authors: '' }
  const raw = new TextDecoder('latin1').decode(bytes)
  const fromXmp = xmp(raw, bytes)
  const fromInfo = info(raw, bytes)
  return { title: fromXmp.title || fromInfo.title || fallback, authors: fromXmp.authors || fromInfo.authors }
}
