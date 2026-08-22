import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_NEXT_COOKIE,
  getAppOrigin,
  normalizeOrigin,
  oauthCallbackUrl,
  prepareOAuthRedirect,
  stashAuthNext,
} from "./app-origin";

describe("normalizeOrigin", () => {
  it("removes trailing slash", () => {
    expect(normalizeOrigin("https://wotta.test/")).toBe(
      "https://wotta.test",
    );
  });
});

describe("getAppOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers window.location.origin in the browser", () => {
    vi.stubGlobal("window", { location: { origin: "https://wotta.test" } });
    expect(getAppOrigin()).toBe("https://wotta.test");
  });

  it("falls back to NEXT_PUBLIC_APP_ORIGIN on the server", () => {
    vi.stubGlobal("window", undefined);
    vi.stubEnv("NEXT_PUBLIC_APP_ORIGIN", "https://wotta.test");
    expect(getAppOrigin()).toBe("https://wotta.test");
  });
});

describe("oauthCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses an exact callback path with no query string", () => {
    vi.stubGlobal("window", { location: { origin: "https://wotta.test" } });
    expect(oauthCallbackUrl()).toBe(
      "https://wotta.test/auth/callback",
    );
  });
});

describe("prepareOAuthRedirect", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores next in a cookie and returns the exact callback URL", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://wotta.test", protocol: "https:" },
    });
    vi.stubGlobal("document", { cookie: "" });
    expect(prepareOAuthRedirect("/inbox")).toBe(
      "https://wotta.test/auth/callback",
    );
    expect(document.cookie).toContain(`${AUTH_NEXT_COOKIE}=%2Finbox`);
  });
});

describe("stashAuthNext", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets SameSite=Lax and Secure on https", () => {
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    vi.stubGlobal("document", { cookie: "" });
    stashAuthNext("/account");
    expect(document.cookie).toContain("SameSite=Lax");
    expect(document.cookie).toContain("Secure");
  });
});
