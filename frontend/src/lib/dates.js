// Local-time date helpers. Replaces ad-hoc `new Date().toISOString().slice(...)`
// which produces UTC dates and is wrong for any user not in UTC.
//
// Why this matters: a trainer in PST logging a win at 5pm on May 4 with
// `toISOString().slice(0,10)` would get '2026-05-05' (UTC), so the entry
// appears under tomorrow on the Celebrate page.

// Returns "YYYY-MM-DD" in the user's local timezone.
export function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Returns "YYYY-MM" in the user's local timezone.
export function thisMonthLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// Same shape from a Date instance.
export function dateToLocalYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function dateToLocalMonth(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
