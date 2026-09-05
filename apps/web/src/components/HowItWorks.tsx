"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, LockKeyhole, TrendingUp } from "lucide-react";
import { NoteVisaCard } from "@/components/NoteVisaCard";
import { UsdcIcon } from "@/components/UsdcIcon";
import { HOW_IT_WORKS_DEMO_NOTE, HOW_IT_WORKS_STEPS } from "@/lib/brand-copy";
import { routeLogoPath } from "@/lib/crypto-icons";

const HANDLE = "@patlu";
const RAILS: { key: string; label: string }[] = [
  { key: "ethereum", label: "Ethereum" },
  { key: "base", label: "Base" },
  { key: "solana", label: "Solana" },
];
const PICKED = "ethereum";
const DEMO_AMOUNT = "10";

const STEPS = HOW_IT_WORKS_STEPS;
type DemoStep = 0 | 1 | 2 | 3;

function VesuEarnPreview() {
  return (
    <div className="radius-surface w-full overflow-hidden border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft font-semibold text-brand-ink">
            V
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">Earn on Vesu</p>
            <p className="text-sm text-muted-foreground">
              Prime market · variable yield
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
          <TrendingUp className="size-3.5" /> Variable APY
        </span>
      </div>

      <div className="mt-5 rounded-2xl border border-border/70 bg-muted/35 p-4">
        <div className="flex items-center justify-end gap-4 text-xs text-muted-foreground">
          <span>Yield accrues in vUSDC</span>
        </div>
        <svg
          viewBox="0 0 360 104"
          role="img"
          aria-label="Illustrative variable yield curve"
          className="mt-2 h-24 w-full text-primary"
        >
          <defs>
            <linearGradient id="vesu-yield-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 88 C38 86 52 77 79 80 C112 83 121 63 151 66 C184 69 195 48 227 51 C262 54 278 25 311 30 C331 33 344 22 360 18 L360 104 L0 104 Z"
            fill="url(#vesu-yield-area)"
          />
          <path
            d="M0 88 C38 86 52 77 79 80 C112 83 121 63 151 66 C184 69 195 48 227 51 C262 54 278 25 311 30 C331 33 344 22 360 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium">
        <span className="inline-flex items-center gap-1.5">
          <UsdcIcon className="size-5" /> USDC
        </span>
        <ArrowRight className="size-4 text-muted-foreground" />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5">
          <span className="relative">
            <UsdcIcon className="size-5" />
            <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
              <LockKeyhole className="size-2" strokeWidth={2.5} />
            </span>
          </span>
          vUSDC
        </span>
      </div>
      <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
        Your vUSDC balance stays shielded. The Vesu action, amount, and timing
        are public onchain.
      </p>
    </div>
  );
}

export function HowItWorks() {
  const ref = useRef<HTMLElement>(null);
  const [chars, setChars] = useState(0);
  const [chainOn, setChainOn] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [cardIn, setCardIn] = useState(false);
  const [earnIn, setEarnIn] = useState(false);
  const [active, setActive] = useState<DemoStep>(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const started = useRef(false);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const at = (ms: number, fn: () => void) =>
    timers.current.push(setTimeout(fn, ms));

  const play = (from: DemoStep) => {
    clear();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setChars(HANDLE.length);
      setChainOn(true);
      setPressed(false);
      setCardIn(true);
      setEarnIn(true);
      setActive(3);
      return;
    }
    const amountThenPay = (t: number, continueToEarn = true) => {
      at(t, () => setActive(1));
      at(t + 300, () => setChainOn(true));
      at(t + 1100, () => setPressed(true));
      at(t + 1350, () => setPressed(false));
      at(t + 1900, () => {
        setActive(2);
        setCardIn(true);
      });
      if (continueToEarn) {
        at(t + 3100, () => {
          setActive(3);
          setEarnIn(true);
        });
      }
    };
    setPressed(false);
    setEarnIn(false);
    if (from === 0) {
      setChars(0);
      setChainOn(false);
      setCardIn(false);
      setActive(0);
      for (let i = 1; i <= HANDLE.length; i++) {
        at(400 + i * 130, () => setChars(i));
      }
      amountThenPay(400 + HANDLE.length * 130 + 500);
    } else if (from === 1) {
      setChars(HANDLE.length);
      setChainOn(false);
      setCardIn(false);
      amountThenPay(200);
    } else if (from === 2) {
      setChars(HANDLE.length);
      setChainOn(true);
      setCardIn(false);
      setActive(2);
      at(150, () => setCardIn(true));
    } else {
      setChars(HANDLE.length);
      setChainOn(true);
      setCardIn(true);
      setActive(3);
      at(100, () => setEarnIn(true));
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          play(0);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typed = HANDLE.slice(0, chars);

  return (
    <section
      ref={ref}
      className="flex min-h-screen w-full flex-col justify-center"
    >
      <h2 className="text-left text-3xl font-bold tracking-tight sm:text-4xl">
        How it works.
      </h2>

      <div className="mt-12 grid gap-12 text-left md:grid-cols-[300px_1fr] md:items-center">
        <div className="relative pl-6">
          <div className="absolute left-0 top-0 h-full w-px bg-border" />
          <div
            className="absolute left-0 top-0 w-px bg-primary transition-[height] duration-500 motion-reduce:transition-none"
            style={{ height: `${((active + 1) / STEPS.length) * 100}%` }}
          />
          <ol className="space-y-8 sm:space-y-10">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <button
                  type="button"
                  onClick={() => play(i as DemoStep)}
                  className={`min-h-10 cursor-pointer text-left transition-opacity duration-300 motion-reduce:transition-none hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 ${
                    i === active ? "opacity-100" : "opacity-40"
                  }`}
                >
                  <p className="text-sm text-muted-foreground">0{i + 1}</p>
                  <p className="mt-1 text-xl font-semibold">{step.title}</p>
                  <p className="mt-2 text-muted-foreground">{step.body}</p>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div
          className="flex flex-col items-center justify-center gap-10"
          aria-hidden
        >
          <div
            className={`flex flex-col items-center gap-5 transition-opacity duration-300 ${
              active >= 2 ? "opacity-35" : "opacity-100"
            }`}
          >
            <div className="flex w-full max-w-md items-center gap-2 sm:w-auto sm:max-w-none">
              <span className="radius-control flex min-w-0 flex-1 items-center border border-border bg-card px-5 py-3 text-lg sm:min-w-[340px] sm:flex-none sm:px-6 sm:py-4 sm:text-xl">
                {typed ? (
                  <span className="truncate">{typed}</span>
                ) : (
                  <span className="truncate text-muted-foreground/60">
                    @handle or email
                  </span>
                )}
                <span
                  className={`ml-0.5 inline-block h-6 w-0.5 shrink-0 bg-primary ${
                    active >= 2 ? "opacity-0" : "animate-pulse"
                  }`}
                />
              </span>
              <span
                className={`radius-control shrink-0 bg-brand px-6 py-3 text-lg font-semibold text-brand-foreground transition-transform duration-200 sm:px-7 sm:py-4 sm:text-xl ${
                  pressed ? "scale-90" : "scale-100"
                }`}
              >
                Send
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span
                className={`radius-control inline-flex items-center gap-2 border px-3 py-2 text-sm font-medium transition-[color,background-color,border-color,transform] duration-300 motion-reduce:transition-none ${
                  chainOn
                    ? "scale-105 border-brand-muted bg-brand-soft text-brand-ink"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={routeLogoPath(PICKED)}
                  alt=""
                  width={24}
                  height={24}
                  className="size-6"
                />
                ETH
              </span>
              <span
                className={`radius-control inline-flex items-center gap-1.5 border px-3 py-2 text-sm font-medium transition-[color,background-color,border-color] duration-300 motion-reduce:transition-none ${
                  chainOn
                    ? "border-primary/40 bg-card text-foreground"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {DEMO_AMOUNT}
                <UsdcIcon className="size-5" />
              </span>
              {RAILS.filter((c) => c.key !== PICKED).map((c) => (
                <span
                  key={c.key}
                  className="radius-control inline-flex items-center gap-1.5 border border-border bg-card px-2.5 py-2 text-xs text-muted-foreground opacity-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={routeLogoPath(c.key)}
                    alt=""
                    width={14}
                    height={14}
                  />
                  {c.label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative min-h-[330px] w-[420px] max-w-full sm:w-[440px]">
            <div
              className={`absolute inset-x-0 top-0 transition-[opacity,transform] duration-400 ease-out motion-reduce:transition-none ${
                cardIn && active !== 3
                  ? "translate-y-0 opacity-100"
                  : "translate-y-6 opacity-0"
              }`}
            >
              <NoteVisaCard
                label="Private note"
                amount={DEMO_AMOUNT}
                recipient="@patlu"
                status="ready to claim"
                note={HOW_IT_WORKS_DEMO_NOTE}
                compact
                interactive={false}
              />
            </div>
            <div
              className={`absolute inset-x-0 top-0 transition-[opacity,transform] duration-400 ease-out motion-reduce:transition-none ${
                earnIn && active === 3
                  ? "translate-y-0 opacity-100"
                  : "translate-y-6 opacity-0"
              }`}
            >
              <VesuEarnPreview />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
