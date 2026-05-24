import { onMounted, onUnmounted, nextTick } from 'vue'

// Trap focus inside a modal-like container while it's open.
// Usage:
//   const containerRef = ref(null)
//   useFocusTrap(containerRef, { onEscape: () => emit('close') })
//
// Behaviour:
//   - Focuses the first focusable element on mount
//   - Loops Tab / Shift+Tab inside the container
//   - Calls onEscape when Esc is pressed
//   - Restores focus to the previously-focused element on unmount

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(containerRef, { onEscape } = {}) {
  let prevActive = null

  function getFocusables() {
    if (!containerRef.value) return []
    return Array.from(containerRef.value.querySelectorAll(FOCUSABLE))
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault()
      onEscape()
      return
    }
    if (e.key !== 'Tab') return
    const items = getFocusables()
    if (!items.length) return
    const first = items[0]
    const last  = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus()
    }
  }

  onMounted(async () => {
    prevActive = document.activeElement
    await nextTick()
    const items = getFocusables()
    if (items.length) items[0].focus()
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
    if (prevActive && typeof prevActive.focus === 'function') {
      try { prevActive.focus() } catch { /* element may have been removed */ }
    }
  })
}
