import { useEffect, useState } from 'react';

// Used to decide whether the sidebar/drawer should be Framer-Motion-animated
// (mobile, where it's an overlay drawer) or simply always visible (desktop,
// where CSS alone positions it statically) — see Layout.jsx/MemberLayout.jsx.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
