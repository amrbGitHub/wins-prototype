// crypto — per-user encryption + deterministic-hash helpers for the
// pseudonym registry.
//
// Threat model: a DB compromise (Supabase breach, snapshot leak) must not
// reveal real names — only opaque hashes and AES-GCM ciphertexts. Decryption
// requires the master secret which lives only in the backend's environment.
// Hashes are HMAC-keyed (not plain SHA256) so rainbow tables don't help either.
//
// Per-user keys are derived via HKDF from the master + userId, so:
//   - the same user always gets the same key (deterministic lookups)
//   - different users get different keys (no cross-user replay)
//   - server-side rotation works by changing the master + re-deriving all keys.
//
// AES-GCM ciphertext layout in the DB (BYTEA):
//   [12 bytes IV][N bytes ciphertext][16 bytes auth tag]

const crypto = require('node:crypto')

const MASTER_B64 = process.env.PSEUDONYM_ENCRYPTION_KEY
let _master = null

function getMaster() {
  if (_master) return _master
  if (!MASTER_B64) {
    throw new Error(
      'PSEUDONYM_ENCRYPTION_KEY is not set in env. Generate with: node -e "console.log(require(\\"crypto\\").randomBytes(32).toString(\\"base64\\"))" and add to backend/.env'
    )
  }
  const buf = Buffer.from(MASTER_B64, 'base64')
  if (buf.length !== 32) {
    throw new Error(`PSEUDONYM_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}).`)
  }
  _master = buf
  return _master
}

// HKDF-SHA256 keyed by master, salted with a fixed app salt, info = userId.
// Returns a 32-byte AES-256 key. Deterministic for a given (master, userId).
function deriveUserKey(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required for key derivation')
  const salt = Buffer.from('wins-prototype/pseudonym/v1', 'utf8')
  const info = Buffer.from(userId, 'utf8')
  const okm  = crypto.hkdfSync('sha256', getMaster(), salt, info, 32)
  return Buffer.from(okm)
}

// HMAC-SHA256 keyed by master, with userId mixed into the message so the
// same real value hashes differently across users (prevents admin / DB
// cross-referencing). Lowercased to canonicalize ("James" === "james").
// Returns a hex string suitable for a TEXT column with a UNIQUE index.
function hashForUser(userId, value) {
  if (!userId) throw new Error('userId required for hashing')
  const h = crypto.createHmac('sha256', getMaster())
  h.update(userId)
  h.update('\x00')                                 // domain separator
  h.update(String(value || '').toLowerCase())
  return h.digest('hex')
}

// AES-256-GCM encrypt. Returns a Buffer ready for BYTEA storage.
function encryptForUser(userId, plaintext) {
  const key = deriveUserKey(userId)
  const iv  = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([
    cipher.update(String(plaintext || ''), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ct, tag])
}

// Normalize whatever Supabase / Postgres hands us back for a BYTEA column
// into a Node Buffer. The PostgREST default is a hex-encoded string with a
// "\x" prefix (e.g. "\x1a2b3c…"); the supabase-js client passes that string
// through unchanged. We also defensively handle Uint8Array and base64 strings
// for forward compatibility with future client versions.
function toBuffer(input) {
  if (Buffer.isBuffer(input))            return input
  if (input instanceof Uint8Array)       return Buffer.from(input)
  if (typeof input === 'string') {
    if (input.startsWith('\\x'))         return Buffer.from(input.slice(2), 'hex')
    // Fallback: assume base64. (Won't happen with default PostgREST but cheap insurance.)
    return Buffer.from(input, 'base64')
  }
  throw new Error(`decryptForUser: unexpected ciphertext input type ${typeof input}`)
}

// AES-256-GCM decrypt. Accepts whatever shape Supabase returns for BYTEA;
// see toBuffer above. Throws on tag mismatch (tampering or wrong key).
function decryptForUser(userId, input) {
  const buf = toBuffer(input)
  if (buf.length < 12 + 16) {
    throw new Error('decryptForUser: ciphertext too short')
  }
  const key = deriveUserKey(userId)
  const iv  = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - 16)
  const ct  = buf.subarray(12, buf.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

module.exports = { deriveUserKey, hashForUser, encryptForUser, decryptForUser }
