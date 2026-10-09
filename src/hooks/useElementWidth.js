import { useEffect, useRef, useState } from 'react';

// Content-box width of an element, kept current with a ResizeObserver.
// Charts draw their SVG at this exact width instead of scaling a fixed
// viewBox, so axis text stays at its real font size on a phone rather than
// shrinking with the drawing.
export function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setWidth(Math.floor(node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
