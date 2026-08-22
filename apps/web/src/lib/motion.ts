import type { Variants } from "framer-motion";

export const buttonTap = {
  scale: 0.99,
  transition: { duration: 0.08, ease: "easeOut" as const },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, ease: "easeOut" },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

export const scrollViewport = {
  once: true,
  amount: 0.25 as const,
};

export const navSpring = {
  type: "spring" as const,
  stiffness: 380,
  damping: 28,
};
