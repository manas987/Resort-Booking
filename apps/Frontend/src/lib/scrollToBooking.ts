export function scrollToBooking(openCalendar: () => void) {
  function cancel() { window.removeEventListener('scroll', onScroll); }
  function onScroll() {
    if (window.scrollY > 1) return;
    cancel();
    openCalendar();
  }
  if (window.scrollY <= 1) openCalendar();
  else {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return cancel;
}
