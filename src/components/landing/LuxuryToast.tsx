"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";

type LuxuryToastProps = {
  message: string | null;
};

export function LuxuryToast({ message }: LuxuryToastProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#d4af37]/45 bg-[#090806]/90 px-5 py-3 text-sm text-[#f6dc8c] shadow-[0_18px_55px_rgba(0,0,0,0.45),0_0_30px_rgba(212,175,55,0.18)] backdrop-blur-xl"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[linear-gradient(135deg,#fff1b8,#d4af37_52%,#7a5a12)] text-[#050505]">
            <Check size={14} strokeWidth={3} />
          </span>
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
