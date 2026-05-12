"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect } from "react";

export function MagneticCursor() {
  const mouseX = useMotionValue(-80);
  const mouseY = useMotionValue(-80);
  const springX = useSpring(mouseX, { stiffness: 120, damping: 24, mass: 0.35 });
  const springY = useSpring(mouseY, { stiffness: 120, damping: 24, mass: 0.35 });

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      mouseX.set(event.clientX - 18);
      mouseY.set(event.clientY - 18);
    };

    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [mouseX, mouseY]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[80] hidden h-9 w-9 rounded-full border border-[#d4af37]/85 mix-blend-screen shadow-[0_0_26px_rgba(212,175,55,0.48)] md:block"
      style={{ x: springX, y: springY }}
    />
  );
}
