import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// A React Router SPA keeps the window's scroll position across route
// changes, so navigating from the bottom of a long contributions list to
// the dashboard would previously drop the user halfway down the new page.
// This resets the viewport on every pathname change.
//
// Renders nothing — it exists purely for the effect, and lives inside the
// router (App.jsx) so useLocation() has a router context to read.
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Smooth by default, but instant for anyone who has asked the OS to
    // reduce motion — a long smooth-scroll is exactly the kind of
    // unrequested movement that setting exists to suppress. Matches the
    // app-wide posture set by MotionConfig reducedMotion="user" in
    // main.jsx and the prefers-reduced-motion block in animations.css.
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    window.scrollTo({ top: 0, left: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  }, [pathname]);

  return null;
}
