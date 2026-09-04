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
]);

function safeNext(next: string | null): string {
  if (!next) return "/inbox";
  if (!next.startsWith("/") || next.startsWith("//")) return "/inbox";
  const path = next.split("?")[0] ?? next;
  if (path === "/register") return "/account?tab=wallet&setup=wallet";
  if (path === "/balance") return "/account?tab=wallet";
  if (ALLOWED.has(path) || path.startsWith("/account") || path.startsWith("/send")) {
    return next;
  }
  return "/inbox";
}

function authErrorRedirect(origin: string, reason: string) {
  const compact = reason.replace(/\s+/g, " ").trim().slice(0, 180) || "auth_failed";
  const response = NextResponse.redirect(
    `${origin}/account?authError=${encodeURIComponent(compact)}`,
  );
  response.cookies.delete(AUTH_NEXT_COOKIE);
  return response;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError =
    searchParams.get("error_code")
    ?? searchParams.get("error")
    ?? undefined;
  const oauthDescription = searchParams.get("error_description") ?? undefined;
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(AUTH_NEXT_COOKIE)?.value;
  const next = safeNext(
    fromCookie ? decodeURIComponent(fromCookie) : searchParams.get("next"),
  );

  if (oauthError) {
    const detail = oauthDescription
      ? `${oauthError}: ${decodeURIComponent(oauthDescription.replace(/\+/g, " "))}`
      : oauthError;
    console.error("[auth/callback] oauth provider error", detail);
    return authErrorRedirect(origin, detail);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      response.cookies.delete(AUTH_NEXT_COOKIE);
      return response;
    }
    console.error("[auth/callback] exchangeCodeForSession failed", error.message, error.code);
    return authErrorRedirect(origin, error.code ? `${error.code}: ${error.message}` : error.message);
  }

  console.error("[auth/callback] missing code and oauth error params");
  return authErrorRedirect(origin, "auth_failed");
}
