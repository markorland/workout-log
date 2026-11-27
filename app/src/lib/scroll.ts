/**
 * The app scrolls inside `.scroller` (the area between the header and the tab
 * bar), never the page itself. In a Home Screen app, iOS 26 blurs whatever
 * scrolls under the status bar; with a page that never scrolls, nothing does.
 */
export function scroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.scroller')
}

export function scrollToTop(behavior: ScrollBehavior = 'auto'): void {
  scroller()?.scrollTo({ top: 0, behavior })
}
