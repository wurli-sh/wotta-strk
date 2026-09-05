import { LockKeyhole } from "lucide-react";
import { UsdcIcon } from "@/components/UsdcIcon";
import { cn } from "@/lib/cn";

export function PrivateTokenIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-9 shrink-0 items-center justify-center", className)} aria-hidden>
      <UsdcIcon className="size-full" />
      <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground">
        <LockKeyhole className="size-2.5" strokeWidth={2.5} />
      </span>
    </span>
  );
}
