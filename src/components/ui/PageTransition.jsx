import { AnimatePresence, motion } from 'framer-motion';
import { useLocation, useOutlet } from 'react-router-dom';

// Subtle fade + translateY on route change (docs/MASTER_TODO.md premium-UI
// pass §44) — kept short (180ms) so navigation still feels instant, not
// like it's waiting on an animation. `useOutlet()` + keying by pathname is
// what lets AnimatePresence animate the outgoing page out, which a plain
// <Outlet/> can't do on its own (its element identity doesn't change).
const variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export default function PageTransition() {
  const location = useLocation();
  const outlet = useOutlet();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={location.pathname} variants={variants} initial="initial" animate="animate" exit="exit">
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}
