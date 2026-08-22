"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function HeroSendBox() {
  const [to, setTo] = useState("");
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = to.trim();
    if (!trimmed) {
      router.push("/send");
      return;
    }
    router.push(`/send?to=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-md gap-2 sm:max-w-xl"
      data-testid="hero-send"
    >
      <input
        type="text"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="@handle or email"
        aria-label="Recipient"
        autoComplete="off"
        className="radius-control w-full flex-1 border-2 border-border bg-card px-5 py-3.5 text-lg outline-none placeholder:text-muted-foreground/70 focus:border-brand focus:ring-2 focus:ring-ring/30"
      />
      <Button
        type="submit"
        size="lg"
        className="shrink-0 sm:px-7"
        data-testid="cta-send"
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        Send
      </Button>
    </form>
  );
}
