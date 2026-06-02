// Tiny memory-logging helper for live diagnostics.
//
// Set LC_MEMORY_LOG=true in env to print one line per gateway turn boundary
// to stdout. Helpful for watching Render's actual RSS over time without
// SSHing in. Off by default — the benchmark script is for static
// measurement; this is for "how does memory drift during real usage."
//
// Output format (one line):
//   [memory] gateway:before  rss=64.2MB heap=10.1/19.0MB ext=3.3MB
//   [memory] gateway:after   rss=68.4MB heap=12.5/21.0MB ext=3.3MB Δrss=+4.2MB

const ENABLED = process.env.LC_MEMORY_LOG === 'true'

let _lastRss = 0

function mb(bytes) { return (bytes / 1024 / 1024).toFixed(1) }

function logMemory(label) {
  if (!ENABLED) return
  const m = process.memoryUsage()
  const delta = _lastRss ? m.rss - _lastRss : 0
  const deltaStr = _lastRss
    ? ` Δrss=${delta >= 0 ? '+' : ''}${mb(delta)}MB`
    : ''
  console.log(
    `[memory] ${label.padEnd(18)}`,
    `rss=${mb(m.rss)}MB`.padEnd(13),
    `heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB`.padEnd(18),
    `ext=${mb(m.external)}MB${deltaStr}`
  )
  _lastRss = m.rss
}

module.exports = { logMemory, ENABLED }
