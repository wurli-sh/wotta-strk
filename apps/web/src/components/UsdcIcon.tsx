import { cn } from "@/lib/cn";
import { tokenIconUrl } from "@/lib/crypto-icons";

export function UsdcIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tokenIconUrl("usdc")}
      alt=""
      width={20}
      height={20}
      className={cn("size-5 shrink-0", className)}
    />
  );
}
