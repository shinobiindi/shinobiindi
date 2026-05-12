"use client";

import { motion } from "framer-motion";
import { Clipboard, ShieldCheck, Signal, Timer } from "lucide-react";

type SignalCardProps = {
  signal: {
    title: string;
    direction: string;
    session: string;
    confidence: string;
    entry: string;
    tp: string;
    sl: string;
  };
  index: number;
  onCopy: (label: string, value: string) => void;
};

const fields = [
  { key: "entry", label: "Entry Price" },
  { key: "tp", label: "Take Profit" },
  { key: "sl", label: "Stop Loss" },
] as const;

export function SignalCard({ signal, index, onCopy }: SignalCardProps) {
  const directionTone =
    signal.direction === "BUY"
      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
      : "border-rose-300/25 bg-rose-300/10 text-rose-200";

  return (
    <motion.article
      initial={{ opacity: 0, y: 42, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="group rounded-lg border border-[#d4af37]/28 bg-white/[0.035] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.36)] backdrop-blur-xl transition duration-500 hover:border-[#f6dc8c]/60 hover:shadow-[0_0_42px_rgba(212,175,55,0.18),0_28px_90px_rgba(0,0,0,0.5)]"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] uppercase text-[#d4af37]">
            <Signal size={14} />
            XAUUSD private signal
          </p>
          <h3 className="font-luxury-serif text-2xl text-[#fff7d6]">{signal.title}</h3>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${directionTone}`}>{signal.direction}</span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 text-xs text-[#b9b1a0]">
        <div className="flex items-center gap-2">
          <Timer size={14} className="text-[#d4af37]" />
          {signal.session}
        </div>
        <div className="flex items-center justify-end gap-2">
          <ShieldCheck size={14} className="text-[#d4af37]" />
          Grade {signal.confidence}
        </div>
      </div>

      <div className="space-y-3">
        {fields.map((field) => {
          const value = signal[field.key];
          return (
            <div key={field.key} className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <div>
                <p className="text-[10px] uppercase text-[#8d8472]">{field.label}</p>
                <p className="font-luxury-sans text-lg font-semibold text-white">{value}</p>
              </div>
              <button
                onClick={() => onCopy(field.label, value)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d4af37]/35 text-[#d4af37] transition hover:border-[#f6dc8c] hover:bg-[#d4af37] hover:text-[#050505]"
                aria-label={`Copy ${field.label}`}
              >
                <Clipboard size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </motion.article>
  );
}
