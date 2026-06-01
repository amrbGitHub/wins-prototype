// Diagnose why ANTHROPIC_API_KEY ends up empty after dotenv load.

const before = process.env.ANTHROPIC_API_KEY
console.log('1. Shell env BEFORE dotenv: exists=' + (before !== undefined) + ', len=' + (before || '').length)

require('../config')

const after = process.env.ANTHROPIC_API_KEY
console.log('2. AFTER dotenv:            exists=' + (after !== undefined) + ', len=' + (after || '').length)

const fs = require('fs')
const path = require('path')
const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
const lines = raw.split(/\r?\n/)
console.log('3. Raw .env lines mentioning ANTHROPIC_API_KEY:')
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  if (l.includes('ANTHROPIC_API_KEY')) {
    const preview = l.slice(0, 30).replace(/[^\x20-\x7E]/g, '?')
    const tail    = l.slice(-20).replace(/[^\x20-\x7E]/g, '?')
    console.log(`   line ${i+1}: len=${l.length}, starts=[${preview}...] ends=[...${tail}]`)
  }
}

// Try parsing this single line with dotenv to see what it produces
const dotenv = require('dotenv')
const anthropicLine = lines.find(l => l.startsWith('ANTHROPIC_API_KEY'))
if (anthropicLine) {
  const parsed = dotenv.parse(anthropicLine)
  console.log('4. dotenv.parse(line) result keys:', Object.keys(parsed))
  console.log('   parsed ANTHROPIC_API_KEY length:', (parsed.ANTHROPIC_API_KEY || '').length)
}
