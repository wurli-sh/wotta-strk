import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EARN_HINT,
  HOW_IT_WORKS_DEMO_NOTE,
  HOW_IT_WORKS_STEPS,
  LANDING_HEADLINE,
  LANDING_INBOX_PROMPT,
  LANDING_SUBHEAD,
  MAINNET_BANNER,
  MAINNET_NAV_CONFIRM,
  PAGE_SUBTITLES,
  QUOTE_PRIVACY_NOTE,
  SETTLED_PRIVATELY,
  SETTLED_PRIVATELY_INBOX,
  SITE_DESCRIPTION,
  SUCCESS_NOTE_PIPELINE,
  TOAST,
  TRUTH_LINE,
  TRUTH_LINE_SHORT,
} from "./brand-copy";

describe("brand-copy", () => {
  it("locks pipeline landing copy", () => {
    expect(LANDING_HEADLINE).toEqual(["Send from anywhere.", "Settle private."]);
    expect(LANDING_SUBHEAD).toContain("private USDC");
    expect(LANDING_SUBHEAD).toContain("Vesu");
    expect(LANDING_INBOX_PROMPT).toBe("Getting paid? Open your inbox.");
    expect(SITE_DESCRIPTION).toBe(
      "Send USDC from any chain. Claim private on Starknet. Earn on Vesu.",
    );
    expect(HOW_IT_WORKS_STEPS).toHaveLength(3);
    expect(HOW_IT_WORKS_DEMO_NOTE).toContain("Vesu");
  });

  it("locks shared product strings", () => {
    expect(TRUTH_LINE).toBe("Source is public. Balance is private. Earn on Vesu.");
    expect(TRUTH_LINE_SHORT).toBe("Source is public. Balance is private.");
    expect(QUOTE_PRIVACY_NOTE).toContain("private after claim");
    expect(MAINNET_BANNER).toContain("Source deposit is public");
    expect(SETTLED_PRIVATELY).toBe("Settled privately on Starknet");
    expect(SETTLED_PRIVATELY_INBOX).toContain("inbox");
    expect(SUCCESS_NOTE_PIPELINE).toContain("inbox");
    expect(MAINNET_NAV_CONFIRM).toContain("private sends");
    expect(ACCOUNT_EARN_HINT).toContain("Vesu");
    expect(PAGE_SUBTITLES.account).toBe(
      "Handles, Ready Wallet, Private Balance, Earn.",
    );
    expect(PAGE_SUBTITLES.activity).toContain("Public workflow");
    expect(PAGE_SUBTITLES.mainnetDemo).toContain("private USDC");
  });

  it("locks informative toast voice", () => {
    expect(TOAST.settledInbox).toContain("inbox");
    expect(TOAST.settledStarknet).toContain("Starknet");
    expect(TOAST.claimed).toContain("private USDC");
    expect(TOAST.networkBlocked).toContain("Ready request");
    expect(JSON.stringify(TOAST).toLowerCase()).not.toMatch(/hold on a sec/);
  });

  it("bans confidential in shared copy", () => {
    const blob = JSON.stringify({
      LANDING_HEADLINE,
      LANDING_SUBHEAD,
      LANDING_INBOX_PROMPT,
      SITE_DESCRIPTION,
      TRUTH_LINE,
      TRUTH_LINE_SHORT,
      QUOTE_PRIVACY_NOTE,
      MAINNET_BANNER,
      HOW_IT_WORKS_STEPS,
      HOW_IT_WORKS_DEMO_NOTE,
      PAGE_SUBTITLES,
      SETTLED_PRIVATELY,
      SETTLED_PRIVATELY_INBOX,
      MAINNET_NAV_CONFIRM,
      ACCOUNT_EARN_HINT,
      SUCCESS_NOTE_PIPELINE,
      TOAST,
    });
    expect(blob.toLowerCase()).not.toMatch(/confidential/);
  });
});
