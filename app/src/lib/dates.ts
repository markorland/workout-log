// Date display. Timestamps (session start/finish) are real moments, shown in local time.
// Date-only values (1RM dates, original workout dates) are stored as midnight UTC and must
// not be shifted into the previous day by the time zone, so only their YYYY-MM-DD is used.

const parse = (d: string) => new Date(d.replace(' ', 'T'))

/** A calendar date stored as "YYYY-MM-DD 00:00:00.000Z". */
export function fmtDay(d: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  if (!d) return ''
  return new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, opts)
}

/** A moment in time, shown as the local date. */
export function fmtWhen(d: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  if (!d) return ''
  const t = parse(d)
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, opts)
}

export function timeOf(d: string): number {
  const t = parse(d).getTime()
  return Number.isNaN(t) ? NaN : t
}
