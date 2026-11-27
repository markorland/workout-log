import { useEffect } from 'react'

/**
 * Freeze the page while a sheet is open and put it back exactly where it was.
 * Stops iOS Safari from scrolling the page when the keyboard opens.
 */
export function useScrollLock(): void {
  useEffect(() => {
    const y = window.scrollY
    const body = document.body
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow }
    body.style.position = 'fixed'
    body.style.top = `-${y}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      body.style.overflow = prev.overflow
      window.scrollTo(0, y)
    }
  }, [])
}
