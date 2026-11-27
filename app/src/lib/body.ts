// Body measurements: entry, latest values, chart series, CSV import/export, reminders.
import { db, nowIso } from './db'
import { parseCsvText } from './programCsv'
import { refreshPending } from './sync'
import type { BodyMeasurement, BodyPart, BodyUnit } from './types'

const stamp = () => ({ dirty: 1 as const, local_updated: nowIso() })
const round2 = (x: number) => Math.round(x * 100) / 100

export const dayOf = (d: string) => d.slice(0, 10)
export const pbDay = (day: string) => `${day} 00:00:00.000Z`
export const measurementId = (day: string, key: string, side: string) => `bm-${day}-${key.replace(/_/g, '-')}-${side || 'x'}`

/** Body parts in head-to-toe order. */
export async function bodyParts(): Promise<BodyPart[]> {
  return (await db.body_parts.toArray()).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
}

/** "Left Arm", "Right Calf", "Waist". */
export const seriesTitle = (part: Pick<BodyPart, 'label'>, side: string) =>
  side ? `${side[0].toUpperCase()}${side.slice(1)} ${part.label}` : part.label

export interface Entry {
  part: BodyPart
  side: '' | 'left' | 'right'
  value: number
}

/** Save a check-in: one row per filled field (a second save the same day replaces it). */
export async function saveMeasurements(day: string, entries: Entry[], source: BodyMeasurement['source'] = 'manual', notes = ''): Promise<void> {
  const rows: BodyMeasurement[] = []
  for (const e of entries) {
    const id = measurementId(day, e.part.key, e.side)
    const existing = await db.body_measurements.get(id)
    rows.push({
      id, date: pbDay(day), body_part: e.part.id, side: e.side, value: round2(e.value), unit: e.part.unit, notes, source,
      deleted_at: '', ...(existing?.updated ? { updated: existing.updated } : {}), ...stamp(),
    })
  }
  await db.body_measurements.bulkPut(rows)
  await refreshPending()
}

export async function deleteMeasurement(id: string): Promise<void> {
  await db.body_measurements.update(id, { deleted_at: new Date().toISOString(), ...stamp() })
  await refreshPending()
}

/** Latest value per part and side: key "<partId>|<side>". */
export async function latestValues(): Promise<Map<string, BodyMeasurement>> {
  const out = new Map<string, BodyMeasurement>()
  const rows = (await db.body_measurements.toArray()).filter((m) => !m.deleted_at).sort((a, b) => (a.date < b.date ? -1 : 1))
  for (const m of rows) out.set(`${m.body_part}|${m.side}`, m)
  return out
}

/** Measurements on one day, for showing under a photo. */
export async function measurementsOn(day: string): Promise<{ title: string; value: number; unit: string }[]> {
  const parts = new Map((await db.body_parts.toArray()).map((p) => [p.id, p]))
  return (await db.body_measurements.where('date').equals(pbDay(day)).toArray())
    .filter((m) => !m.deleted_at && parts.has(m.body_part))
    .sort((a, b) => parts.get(a.body_part)!.sort_order - parts.get(b.body_part)!.sort_order || a.side.localeCompare(b.side))
    .map((m) => ({ title: seriesTitle(parts.get(m.body_part)!, m.side), value: m.value, unit: m.unit }))
}

export interface Series {
  part: BodyPart
  side: '' | 'left' | 'right'
  title: string
  points: BodyMeasurement[] // oldest first
}

/** One series per part and side that has data, head to toe, left before right. */
export async function allSeries(): Promise<Series[]> {
  const parts = await bodyParts()
  const rows = (await db.body_measurements.toArray()).filter((m) => !m.deleted_at)
  const out: Series[] = []
  for (const part of parts) {
    for (const side of part.has_side ? (['left', 'right'] as const) : ([''] as const)) {
      const points = rows.filter((m) => m.body_part === part.id && m.side === side).sort((a, b) => (a.date < b.date ? -1 : 1))
      if (points.length) out.push({ part, side, title: seriesTitle(part, side), points })
    }
  }
  return out
}

/** Add a custom site (e.g. "Glutes"). */
export async function addCustomPart(label: string, hasSide: boolean, unit: BodyUnit): Promise<BodyPart> {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const existing = (await db.body_parts.toArray()).find((p) => p.key === key)
  if (existing) return existing
  const maxOrder = Math.max(0, ...(await db.body_parts.toArray()).map((p) => p.sort_order))
  const part: BodyPart = {
    id: `bp-custom-${key.replace(/_/g, '-')}`, key, label: label.trim(), has_side: hasSide, unit, sort_order: maxOrder + 10,
    custom: true, ...stamp(),
  }
  await db.body_parts.put(part)
  await refreshPending()
  return part
}

// ---------------------------------------------------------------------------
// CSV import / export (long format: date,body_part,side,value,unit,notes)
// ---------------------------------------------------------------------------

export interface ImportRow {
  line: number
  day: string
  partKey: string // matched or proposed key
  partLabel: string
  side: '' | 'left' | 'right'
  value: number // converted to the part's unit
  unit: BodyUnit
  notes: string
  newPart: boolean // part not in the library yet
  splitFrom: string // original name if a side was split out of it ("Right Arm")
  converted: string // e.g. "38.1 cm → 15 in"
  duplicate: boolean // a value already exists for that day, part and side
}

export interface ImportPreview {
  rows: ImportRow[]
  errors: string[]
}

const SIDE_WORDS: Record<string, 'left' | 'right'> = { left: 'left', l: 'left', right: 'right', r: 'right' }

function parseDay(s: string): string | null {
  const t = s.trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}

/** "Right Arm", "right_arm", "arm right", "Arm (R)" -> { key: "arm", side: "right" }. */
export function splitPartName(raw: string): { key: string; side: '' | 'left' | 'right' } {
  const words = raw.toLowerCase().replace(/[()]/g, ' ').split(/[\s_-]+/).filter(Boolean)
  let side: '' | 'left' | 'right' = ''
  const rest: string[] = []
  for (const w of words) {
    if (!side && SIDE_WORDS[w]) side = SIDE_WORDS[w]
    else rest.push(w)
  }
  return { key: rest.join('_'), side }
}

const DEFAULT_UNIT = (key: string): BodyUnit => (key === 'bodyweight' ? 'lb' : key === 'body_fat' ? '%' : 'in')

function convert(value: number, from: string, to: BodyUnit): { value: number; note: string } | null {
  const f = from.toLowerCase().trim() || to
  if (f === to || (f === 'inch' && to === 'in') || (f === 'lbs' && to === 'lb')) return { value, note: '' }
  if (f === 'cm' && to === 'in') return { value: round2(value / 2.54), note: `${value} cm → ${round2(value / 2.54)} in` }
  if (f === 'mm' && to === 'in') return { value: round2(value / 25.4), note: `${value} mm → ${round2(value / 25.4)} in` }
  if (f === 'kg' && to === 'lb') return { value: round2(value * 2.20462), note: `${value} kg → ${round2(value * 2.20462)} lb` }
  return null
}

export async function previewMeasurementCsv(text: string): Promise<ImportPreview> {
  const table = parseCsvText(text)
  const errors: string[] = []
  if (table.length < 2) return { rows: [], errors: ['The file has no data rows.'] }
  const header = table[0].map((h) => h.trim().toLowerCase())
  for (const c of ['date', 'body_part', 'value']) if (!header.includes(c)) errors.push(`Missing column: ${c}.`)
  if (errors.length) return { rows: [], errors }
  const col = (r: string[], name: string) => (header.includes(name) ? (r[header.indexOf(name)] ?? '').trim() : '')

  const parts = await db.body_parts.toArray()
  const byKey = new Map(parts.map((p) => [p.key, p]))
  const byLabel = new Map(parts.map((p) => [p.label.toLowerCase(), p]))
  const existing = new Set((await db.body_measurements.toArray()).filter((m) => !m.deleted_at).map((m) => m.id))
  const rows: ImportRow[] = []
  const seen = new Set<string>()

  table.slice(1).forEach((r, i) => {
    const line = i + 2
    const day = parseDay(col(r, 'date'))
    if (!day) return void errors.push(`Row ${line}: date must be YYYY-MM-DD or M/D/YYYY.`)
    const rawName = col(r, 'body_part')
    if (!rawName) return void errors.push(`Row ${line}: body_part is empty.`)
    const value = Number(col(r, 'value'))
    if (col(r, 'value') === '' || Number.isNaN(value)) return void errors.push(`Row ${line}: value must be a number.`)

    // Side from its own column, or split out of the name ("Right Arm").
    const sideCol = col(r, 'side').toLowerCase()
    if (sideCol && !SIDE_WORDS[sideCol]) return void errors.push(`Row ${line}: side must be left, right or blank.`)
    const split = splitPartName(rawName)
    const part = byLabel.get(rawName.toLowerCase()) ?? byKey.get(rawName.toLowerCase().replace(/\s+/g, '_')) ?? byKey.get(split.key)
    const side = (sideCol ? SIDE_WORDS[sideCol] : '') || (part && part !== byLabel.get(rawName.toLowerCase()) ? split.side : '')
    const key = part?.key ?? split.key
    const splitFrom = !sideCol && split.side && side ? rawName : ''
    if (part && part.has_side && !side) return void errors.push(`Row ${line}: ${part.label} needs a side (left or right).`)
    if (part && !part.has_side && side) return void errors.push(`Row ${line}: ${part.label} doesn't have sides.`)

    const unitTo = part?.unit ?? DEFAULT_UNIT(key)
    const conv = convert(value, col(r, 'unit'), unitTo)
    if (!conv) return void errors.push(`Row ${line}: can't convert ${col(r, 'unit')} to ${unitTo}.`)
    const id = measurementId(day, key, side)
    if (seen.has(id)) return void errors.push(`Row ${line}: duplicate of an earlier row (same date, part and side).`)
    seen.add(id)
    rows.push({
      line, day, partKey: key, partLabel: part?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), side,
      value: conv.value, unit: unitTo, notes: col(r, 'notes'), newPart: !part, splitFrom, converted: conv.note,
      duplicate: existing.has(id),
    })
  })
  return { rows, errors }
}

/** Import checked rows. New parts are created first; duplicates skipped unless `overwrite`. */
export async function importMeasurements(rows: ImportRow[], overwrite: boolean): Promise<{ added: number; skipped: number }> {
  let added = 0
  let skipped = 0
  const parts = new Map((await db.body_parts.toArray()).map((p) => [p.key, p]))
  for (const r of rows.filter((x) => x.newPart)) {
    if (!parts.has(r.partKey)) {
      const sided = rows.some((x) => x.partKey === r.partKey && x.side)
      parts.set(r.partKey, await addCustomPart(r.partLabel, sided, r.unit))
    }
  }
  const byDay = new Map<string, Entry[]>()
  for (const r of rows) {
    if (r.duplicate && !overwrite) {
      skipped++
      continue
    }
    const list = byDay.get(r.day) ?? []
    list.push({ part: parts.get(r.partKey)!, side: r.side, value: r.value })
    byDay.set(r.day, list)
    added++
  }
  for (const [day, entries] of byDay) await saveMeasurements(day, entries, 'csv')
  return { added, skipped }
}

export async function measurementCsv(): Promise<string> {
  const parts = new Map((await db.body_parts.toArray()).map((p) => [p.id, p]))
  const rows = (await db.body_measurements.toArray())
    .filter((m) => !m.deleted_at && parts.has(m.body_part))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : parts.get(a.body_part)!.sort_order - parts.get(b.body_part)!.sort_order))
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return ['date,body_part,side,value,unit,notes', ...rows.map((m) => [dayOf(m.date), parts.get(m.body_part)!.key, m.side, m.value, m.unit, m.notes].map(cell).join(','))].join('\n') + '\n'
}
