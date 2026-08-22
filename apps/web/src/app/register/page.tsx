import { redirect } from "next/navigation";

/** Wallet setup moved into Account → Wallet. */
export default function RegisterRedirect() {
  redirect("/account?tab=wallet&setup=wallet");
}
