// Local-time date helpers. Replaces ad-hoc `new Date().toISOString().slice(...)`.
//
// IMPORTANT: the backend runs on the server, which usually has TZ=UTC. If you
// want "today in the user's tz" you need the user's tz from the request.
// For now we still produce UTC-based defaults on the server, but the helpers
// accept an optional Date so callers can pass through a frontend-supplied date.

function todayUTC() {
  return new Date().toISOString().slice(0, 10)
}
function thisMonthUTC() {
  return new Date().toISOString().slice(0, 7)
}

module.exports = { todayUTC, thisMonthUTC }
