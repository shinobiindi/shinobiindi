"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowUpRight, Crown, Radio, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { HeroArtifact } from "./HeroArtifact";
import { LuxuryToast } from "./LuxuryToast";
import { MagneticCursor } from "./MagneticCursor";
import { packages, servicePillars, signalCards, stats } from "./data";
import { SignalCard } from "./SignalCard";

export function LuxuryLandingPage() {
  const [toast, setToast] = useState<string | null>(null);
  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.28], [1, 0.22]);
  const heroScale = useTransform(scrollYProgress, [0, 0.28], [1, 0.94]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const copyValue = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setToast(`${label} copied: ${value}`);
  };

  return (
    <main className="luxury-page min-h-screen overflow-hidden bg-[#050505] text-[#f8f3df]">
      <MagneticCursor />
      <LuxuryToast message={toast} />
      <div className="luxury-grain" aria-hidden />
      <div className="luxury-vignette" aria-hidden />

      <nav className="fixed left-0 top-0 z-50 w-full border-b border-[#d4af37]/20 bg-[#050505]/84 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/shinobi-logo-nav.png" alt="SHINOBI INDI" width={44} height={44} className="h-10 w-10 object-contain" priority />
            <div>
              <p className="font-luxury-serif text-base font-semibold tracking-[0.03em] text-[#f6dc8c] sm:text-lg">SHINOBI INDI</p>
              <p className="font-luxury-sans text-[10px] font-medium uppercase tracking-[0.14em] text-[#b9b1a0]">Private Gold Signal Desk</p>
            </div>
          </Link>
          <div className="hidden items-center gap-9 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#d9d0b7] md:flex">
            <a href="#signals" className="transition hover:text-[#f6dc8c]">Signals</a>
            <a href="#experience" className="transition hover:text-[#f6dc8c]">Experience</a>
            <a href="#access" className="transition hover:text-[#f6dc8c]">Access</a>
          </div>
          <Link
            href="/access"
            className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/45 px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#f6dc8c] transition hover:border-[#f6dc8c] hover:bg-[#d4af37] hover:text-[#050505]"
          >
            Dashboard
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </nav>

      <motion.header
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative flex min-h-[94svh] flex-col items-center justify-center px-5 pb-14 pt-28 text-center"
      >
        <div className="mb-4 inline-flex items-center gap-2 border border-[#d4af37]/25 bg-[#d4af37]/8 px-4 py-2 text-[10px] uppercase text-[#f6dc8c]">
          <Crown size={14} />
          Done-for-you XAUUSD intelligence
        </div>

        <HeroArtifact />

        <motion.h1
          initial={{ opacity: 0, y: 36 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="font-luxury-serif mt-2 max-w-5xl text-5xl font-semibold leading-[0.95] text-[#f8f3df] sm:text-7xl lg:text-8xl"
        >
          SHINOBI INDI
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-6 max-w-2xl font-luxury-sans text-base leading-8 text-[#b9b1a0] sm:text-lg"
        >
          A premium signal dashboard for gold traders who want clean entries, mapped risk, and fast execution without staring at charts all day.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.26, ease: [0.22, 1, 0.36, 1] }}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
        >
          <a href="#signals" className="gold-button inline-flex min-w-[210px] items-center justify-center gap-2 rounded-full px-7 py-4 text-sm font-semibold uppercase text-[#050505]">
            View Live Flow
            <Radio size={16} />
          </a>
          <Link
            href="/access"
            className="inline-flex min-w-[210px] items-center justify-center rounded-full border border-[#f6dc8c]/28 px-7 py-4 text-sm font-semibold uppercase text-[#f6dc8c] transition hover:border-[#f6dc8c] hover:bg-white/5"
          >
            Client Login
          </Link>
        </motion.div>
      </motion.header>

      <section className="border-y border-[#d4af37]/12">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-[#d4af37]/12 px-px md:grid-cols-4">
          {stats.map((item) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="bg-[#050505] px-5 py-8 text-center"
            >
              <p className="font-luxury-sans text-[10px] uppercase text-[#8d8472]">{item.label}</p>
              <p className="font-luxury-sans mt-2 text-2xl font-semibold text-[#f6dc8c]">{item.value}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="signals" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
        <RevealTitle
          eyebrow="The Signal Dashboard"
          title="One-tap execution, composed like a private trading desk."
          body="Entry, TP, and SL are packaged in a clean signal card. Tap once, copy instantly, execute with discipline."
        />
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {signalCards.map((signal, index) => (
            <SignalCard key={signal.title} signal={signal} index={index} onCopy={copyValue} />
          ))}
        </div>
      </section>

      <section id="experience" className="border-y border-[#d4af37]/12 bg-[#0a0907]">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-24 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:py-32">
          <RevealTitle
            eyebrow="Private Workflow"
            title="Built for traders who value precision over noise."
            body="SHINOBI INDI removes messy group alerts and replaces them with a focused dashboard, locked access, and performance context."
            align="left"
          />
          <div className="grid gap-px bg-[#d4af37]/14">
            {servicePillars.map((pillar, index) => (
              <motion.div
                key={pillar}
                initial={{ opacity: 0, x: 26 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.65, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-4 bg-[#0a0907] px-5 py-6"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d4af37]/35 text-[#d4af37]">
                  <ShieldCheck size={17} />
                </span>
                <p className="font-luxury-sans text-sm leading-7 text-[#d9d0b7] sm:text-base">{pillar}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="access" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
        <RevealTitle
          eyebrow="Access Key"
          title="Choose the mission window that matches your execution cycle."
          body="Every plan includes realtime XAUUSD alerts, tactical risk planner, instant dashboard access, and performance history."
        />
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {packages.map((plan, index) => (
            <motion.article
              key={plan.name}
              initial={{ opacity: 0, y: 42, scale: 0.96 }}
              whileInView={{ opacity: 1, y: 0, scale: plan.featured ? 1.03 : 1 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
              className={`rounded-lg border p-7 text-center transition duration-500 ${
                plan.featured
                  ? "border-[#f6dc8c]/70 bg-[#d4af37]/10 shadow-[0_0_55px_rgba(212,175,55,0.18)]"
                  : "border-[#d4af37]/24 bg-white/[0.025] hover:border-[#d4af37]/55"
              }`}
            >
              <p className="font-luxury-serif text-2xl text-[#fff7d6]">{plan.name}</p>
              <p className="mt-5 text-sm text-[#8d8472] line-through">{plan.original}</p>
              <p className="font-luxury-sans mt-2 text-5xl font-semibold text-[#f6dc8c]">{plan.promo}</p>
              <p className="mx-auto mt-5 max-w-[240px] text-sm leading-7 text-[#b9b1a0]">{plan.note}</p>
              <Link
                href="/access"
                className={`mt-8 inline-flex w-full items-center justify-center rounded-full px-6 py-4 text-sm font-semibold uppercase ${
                  plan.featured ? "gold-button text-[#050505]" : "border border-[#d4af37]/35 text-[#f6dc8c] transition hover:bg-[#d4af37] hover:text-[#050505]"
                }`}
              >
                Get Access
              </Link>
            </motion.article>
          ))}
        </div>
      </section>

      <footer className="border-t border-[#d4af37]/12 px-5 py-10 text-center">
        <p className="font-luxury-serif text-lg text-[#f6dc8c]">SHINOBI INDI</p>
        <p className="mt-2 text-[10px] uppercase text-[#746b59]">Discipline. Precision. Profit.</p>
      </footer>
    </main>
  );
}

function RevealTitle({
  eyebrow,
  title,
  body,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  body: string;
  align?: "center" | "left";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 34, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
      className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-xl text-left"}
    >
      <p className="font-luxury-sans text-[11px] uppercase text-[#d4af37]">{eyebrow}</p>
      <h2 className="font-luxury-serif mt-4 text-3xl font-semibold leading-tight text-[#fff7d6] sm:text-5xl">{title}</h2>
      <p className="font-luxury-sans mt-5 text-sm leading-8 text-[#b9b1a0] sm:text-base">{body}</p>
    </motion.div>
  );
}
