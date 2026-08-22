import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_NEXT_COOKIE } from "@/lib/app-origin";
import { createClient } from "@/lib/supabase/server";

const ALLOWED = new Set([
  "/",
  "/send",
  "/inbox",
  "/account",
  "/claim",
  "/c",
  "/privacy",
  "/withdraw",
  "/balance",
]);

function safeNext(next: string | null): string {
  if (!next) return "/inbox";
  if (!next.startsWith("/") || next.startsWith("//")) return "/inbox";
  const path = next.split("?")[0] ?? next;
  if (path === "/register") return "/account?tab=wallet&setup=wallet";
  if (ALLOWED.has(path) || path.startsWith("/account") || path.startsWith("/send")) {
    return next;
  }
  return "/inbox";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(AUTH_NEXT_COOKIE)?.value;
  const next = safeNext(
    fromCookie ? decodeURIComponent(fromCookie) : searchParams.get("next"),
  );
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      response.cookies.delete(AUTH_NEXT_COOKIE);
      return response;
    }
  }
  const response = NextResponse.redirect(
    `${origin}/account?authError=${encodeURIComponent("auth_failed")}`,
  );
  response.cookies.delete(AUTH_NEXT_COOKIE);
  return response;
}
