'use client';

import { motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: 'easeOut' }}>{children}</MotionConfig>;
}

/** Keep server-rendered content visible even before JavaScript loads. */
export function PageEntrance({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={pathname}
      initial={false}
      animate={reduce ? { opacity: 1 } : { opacity: [0.65, 1], y: [8, 0] }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      className="workspace-content"
    >
      {children}
    </motion.div>
  );
}
