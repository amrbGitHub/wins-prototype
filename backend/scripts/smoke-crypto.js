// Smoke test for crypto helpers. Run with: PSEUDONYM_ENCRYPTION_KEY=... node scripts/smoke-crypto.js
// Generates an ephemeral key if env is unset (so the script always runs standalone).

if (!process.env.PSEUDONYM_ENCRYPTION_KEY) {
  process.env.PSEUDONYM_ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('base64')
  console.log('(using ephemeral key for this run)\n')
}

const { hashForUser, encryptForUser, decryptForUser, deriveUserKey } = require('../lib/crypto')

const userA = '11111111-1111-1111-1111-111111111111'
const userB = '22222222-2222-2222-2222-222222222222'

// 1. Hash is deterministic for same user + value
const h1 = hashForUser(userA, 'James')
const h2 = hashForUser(userA, 'james')   // case-insensitive
const h3 = hashForUser(userA, 'James')
console.log('hash same user, same value (case-insensitive):', h1 === h2 && h2 === h3 ? 'OK' : 'FAIL')

// 2. Hash differs across users
const h4 = hashForUser(userB, 'James')
console.log('hash differs across users for same value:    ', h1 !== h4 ? 'OK' : 'FAIL')

// 3. Encrypt → decrypt round trip
const ct = encryptForUser(userA, 'James')
const pt = decryptForUser(userA, ct)
console.log('encrypt → decrypt round-trip:                ', pt === 'James' ? 'OK' : `FAIL (got "${pt}")`)

// 4. Wrong user cannot decrypt (tag mismatch throws)
let crossUserFailed = false
try { decryptForUser(userB, ct) } catch { crossUserFailed = true }
console.log('cross-user decrypt rejected (tag mismatch):  ', crossUserFailed ? 'OK' : 'FAIL')

// 5. Per-user keys are deterministic + differ across users
const k1 = deriveUserKey(userA)
const k2 = deriveUserKey(userA)
const k3 = deriveUserKey(userB)
console.log('per-user key deterministic:                  ', k1.equals(k2) ? 'OK' : 'FAIL')
console.log('per-user key differs across users:           ', !k1.equals(k3) ? 'OK' : 'FAIL')
