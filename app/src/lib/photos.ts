// Progress photos: resize on the phone, queue offline, upload, view with a file token.
//
// Privacy (docs/Plan.md, "Privacy for photos"): files are stored "protected" on
// the server, so viewing needs a short-lived file token. Full-size photos are
// never cached on the phone; only small thumbnails of the latest photos are.
import { db, newId, pbDate } from './db'
import { pb } from './pb'
import type { ProgressPhoto, QueuedPhoto } from './types'

export const POSES = ['front', 'side', 'back', 'flexed arm'] as const
const THUMBS_KEPT = 16

/**
 * Re-encode an image as JPEG no larger than `max` px on its long side.
 * Drawing through a canvas converts iPhone HEIC, applies the rotation, and
 * drops all metadata (including GPS location).
 */
export async function resizeImage(file: Blob, max: number, quality = 0.85): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))), 'image/jpeg', quality),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Add a photo: resized now, kept on the phone until it uploads. */
export async function addPhoto(file: File, day: string, pose: string, notes: string): Promise<string> {
  const [image, thumbnail] = await Promise.all([resizeImage(file, 2000), resizeImage(file, 400, 0.8)])
  const id = newId()
  const q: QueuedPhoto = { id, date: `${day} 00:00:00.000Z`, pose, notes, image, thumbnail, created: new Date().toISOString() }
  await db.photo_queue.put(q)
  await cacheThumb(id, thumbnail)
  return id
}

/** Upload queued photos (called by sync once the server answers). Returns how many uploaded. */
export async function uploadQueuedPhotos(): Promise<number> {
  let n = 0
  for (const q of await db.photo_queue.orderBy('created').toArray()) {
    const fd = new FormData()
    fd.append('id', q.id)
    fd.append('date', q.date)
    fd.append('pose', q.pose)
    fd.append('notes', q.notes)
    fd.append('image', new File([q.image], `${q.id}.jpg`, { type: 'image/jpeg' }))
    fd.append('thumbnail', new File([q.thumbnail], `${q.id}-thumb.jpg`, { type: 'image/jpeg' }))
    let rec: Record<string, unknown>
    try {
      rec = await pb().collection('progress_photos').create(fd)
    } catch (e) {
      // Already uploaded (e.g. the response was lost): fetch it instead.
      if ((e as { status?: number }).status === 400) rec = await pb().collection('progress_photos').getOne(q.id)
      else throw e
    }
    await db.transaction('rw', db.progress_photos, db.photo_queue, async () => {
      await db.progress_photos.put({ ...(rec as unknown as ProgressPhoto), dirty: 0, local_updated: '' })
      await db.photo_queue.delete(q.id)
    })
    n++
  }
  return n
}

/** Keep only the newest few thumbnails on the phone. */
async function cacheThumb(id: string, blob: Blob): Promise<void> {
  await db.photo_thumbs.put({ id, blob, cached: new Date().toISOString() })
  const all = await db.photo_thumbs.orderBy('cached').toArray()
  if (all.length > THUMBS_KEPT) await db.photo_thumbs.bulkDelete(all.slice(0, all.length - THUMBS_KEPT).map((t) => t.id))
}

let token: { value: string; at: number } | null = null

/** A protected-file token (valid ~3 minutes on the server; refreshed after 2). */
async function fileToken(): Promise<string> {
  if (!token || Date.now() - token.at > 120_000) token = { value: await pb().files.getToken(), at: Date.now() }
  return token.value
}

/** URL for a photo's full image or thumbnail. Needs a connection. */
export async function photoUrl(p: ProgressPhoto, kind: 'image' | 'thumbnail'): Promise<string> {
  const file = kind === 'image' ? p.image : p.thumbnail || p.image
  const record = { ...p, collectionName: 'progress_photos' } as unknown as Record<string, unknown> & { id: string; collectionName: string }
  return pb().files.getURL(record, file, { token: await fileToken() })
}

/**
 * Thumbnail to show: the cached blob if we have one (works offline), else
 * fetch it from the server and cache it.
 */
export async function thumbSrc(p: ProgressPhoto | QueuedPhoto): Promise<string | null> {
  const cached = await db.photo_thumbs.get(p.id)
  if (cached) return URL.createObjectURL(cached.blob)
  if ('thumbnail' in p && p.thumbnail instanceof Blob) return URL.createObjectURL(p.thumbnail)
  try {
    const url = await photoUrl(p as ProgressPhoto, 'thumbnail')
    const blob = await (await fetch(url)).blob()
    await cacheThumb(p.id, blob)
    return URL.createObjectURL(blob)
  } catch {
    return null // offline and not cached
  }
}

/** Photos to show: uploaded and waiting, newest first. */
export async function listPhotos(): Promise<(ProgressPhoto | (QueuedPhoto & { queued: true }))[]> {
  const uploaded = (await db.progress_photos.toArray()).filter((p) => !p.deleted_at)
  const queued = (await db.photo_queue.toArray()).map((q) => ({ ...q, queued: true as const }))
  return [...queued, ...uploaded].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export async function deletePhoto(id: string): Promise<void> {
  if (await db.photo_queue.get(id)) {
    await db.photo_queue.delete(id)
  } else {
    await db.progress_photos.update(id, { deleted_at: pbDate(), dirty: 1, local_updated: new Date().toISOString() })
  }
  await db.photo_thumbs.delete(id)
}
