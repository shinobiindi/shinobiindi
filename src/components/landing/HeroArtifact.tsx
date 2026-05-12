"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";

export function HeroArtifact() {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 0.35], [0, -60]);
  const scale = useTransform(scrollYProgress, [0, 0.35], [1, 0.82]);
  const opacity = useTransform(scrollYProgress, [0, 0.32], [1, 0.28]);

  return (
    <motion.div
      className="relative mx-auto flex h-[360px] w-[360px] items-center justify-center sm:h-[520px] sm:w-[520px]"
      style={{ y, scale, opacity }}
    >
      <motion.div
        aria-hidden
        className="absolute inset-8 rounded-full border border-[#d4af37]/30 shadow-[inset_0_0_60px_rgba(212,175,55,0.08),0_0_70px_rgba(212,175,55,0.16)]"
        animate={{ rotate: 360 }}
        transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-14 rounded-full border border-[#f6dc8c]/20"
        animate={{ rotate: -360 }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        className="luxury-shuriken relative flex h-64 w-64 items-center justify-center sm:h-80 sm:w-80"
        animate={{ y: [0, -12, 0], rotate: [0, 2, 0] }}
        transition={{ duration: 5.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_35%,rgba(255,241,184,0.36),rgba(212,175,55,0.14)_34%,rgba(5,5,5,0)_68%)] blur-xl" />
        <div className="absolute h-full w-full rotate-45 rounded-[34%] border border-[#d4af37]/35 bg-[linear-gradient(135deg,rgba(212,175,55,0.16),rgba(246,220,140,0.03)_44%,rgba(5,5,5,0.72))] shadow-[0_24px_90px_rgba(212,175,55,0.22)]" />
        <div className="relative flex h-52 w-52 items-center justify-center rounded-full border border-[#f6dc8c]/40 bg-[#050505]/92 shadow-[inset_0_0_35px_rgba(212,175,55,0.18)] sm:h-64 sm:w-64">
          <Image
            src="/shinobi-logo-small-size.png"
            alt="SHINOBI INDI emblem"
            width={288}
            height={288}
            sizes="(max-width: 640px) 192px, 256px"
            className="h-48 w-48 object-contain sm:h-64 sm:w-64"
            priority
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
