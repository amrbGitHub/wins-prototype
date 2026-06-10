// Global error handler — converts every uncaught error from a route handler
// into a generic JSON response. Internal details (stack traces, upstream URLs,
// SDK error bodies) are logged to the server only and NEVER returned to the
// client. Addresses Finding #4 from the cybersec audit.
//
// Routes can opt into specific status codes / messages by throwing an Error
// with `.status` and `.publicMessage` set; otherwise the user sees a generic
// 500 "Service temporarily unavailable, please try again later."

function safeMessageForStatus(status) {
  switch (status) {
    case 400: return 'Bad request.'
    case 401: return 'Authentication required.'
    case 403: return 'Forbidden.'
    case 404: return 'Not found.'
    case 409: return 'Conflict — the resource was modified.'
    case 413: return 'Request payload too large.'
    case 429: return 'Too many requests. Please wait a moment and try again.'
    default:  return 'Service temporarily unavailable. Please try again later.'
  }
}

function errorHandler(err, req, res, _next) {
  // Log full detail server-side. Includes the message, stack, and upstream
  // cause where present. This is the only place internal infrastructure
  // identifiers (ngrok URLs, Supabase project refs) are allowed to surface.
  // eslint-disable-next-line no-console
  console.error('[unhandled-error]', {
    path:    req.originalUrl,
    method:  req.method,
    message: err?.message,
    stack:   err?.stack,
    cause:   err?.cause,
  })

  if (res.headersSent) return

  const status = Number.isInteger(err?.status) ? err.status : 500
  const body = { error: err?.publicMessage || safeMessageForStatus(status) }
  res.status(status).json(body)
}

// Thin helper for routes that want to short-circuit with a sanitized client
// message while preserving the original error for server logs.
//   throw httpError(404, 'Goal not found')          // public + internal match
//   throw httpError(503, 'AI temporarily unavailable', upstreamErr)
function httpError(status, publicMessage, cause) {
  const e = new Error(publicMessage || safeMessageForStatus(status))
  e.status = status
  e.publicMessage = publicMessage
  if (cause) e.cause = cause
  return e
}

module.exports = { errorHandler, httpError, safeMessageForStatus }
