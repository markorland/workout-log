import { useEffect, useState } from 'react'
import { scroller, scrollToTop } from '../lib/scroll'

/** A floating ↑ button that appears once you've scrolled down; tap to jump to the top. */
export default function ScrollToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = scroller()
    if (!el) return
    const onScroll = () => setShow(el.scrollTop > 400)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  if (!show) return null
  return (
    <button className="to-top" aria-label="Back to top" onClick={() => scrollToTop('smooth')}>
      ↑
    </button>
  )
}
