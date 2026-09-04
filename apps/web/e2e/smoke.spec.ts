import { test, expect } from "@playwright/test";

test("landing + Send shell", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Send from anywhere/i }),
  ).toBeVisible();
  await page.goto("/send");
  await expect(page.getByText("1").first()).toBeVisible();
  await expect(page.getByTestId("denom-1")).toBeVisible();
  await expect(page.getByTestId("denom-100")).toBeVisible();
  await expect(page.getByTestId("denom-0.1")).toHaveCount(0);
  await expect(page.getByText(/Settles to private USDC/i)).toBeVisible();
});

test("balance route redirects to Account wallet", async ({ page }) => {
  await page.goto("/balance");
  await expect(page).toHaveURL(/\/account\?tab=wallet/);
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
});

test("withdraw route redirects to Claim", async ({ page }) => {
  await page.goto("/withdraw");
  await expect(page).toHaveURL(/\/claim\/?(\?|$)/);
});

test("privacy page honest labels", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByTestId("privacy-page")).toContainText(/unaudited/i);
});

test("signed-out nav hides network menu; mode still persists via storage", async ({ page }) => {
  await page.goto("/send");
  await expect(page.getByTestId("sign-in")).toBeVisible();
  await expect(page.getByTestId("network-menu")).toHaveCount(0);
  await expect(page.getByTestId("denom-0.1")).toHaveCount(0);

  await page.evaluate(() => window.localStorage.setItem("wotta-network-mode", "mainnet"));
  await page.reload();
  await expect(page.getByTestId("sign-in")).toBeVisible();
  await expect(page.getByTestId("network-menu")).toHaveCount(0);
  await expect(page.getByTestId("denom-0.1")).toBeVisible();
  await expect(page.getByTestId("source-ethereum")).toBeDisabled();

  await page.evaluate(() => window.localStorage.setItem("wotta-network-mode", "testnet"));
  await page.reload();
  await expect(page.getByTestId("denom-0.1")).toHaveCount(0);
});

test.describe("Mainnet mode isolation", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("wotta-network-mode", "mainnet"));
  });

  test("Send keeps private locked and sources fail-closed until admission", async ({ page }) => {
    await page.goto("/send");
    await expect(page.getByRole("heading", { name: "Send", exact: true })).toBeVisible();
    for (const amount of ["0.1", "1"]) {
      await expect(page.getByTestId(`denom-${amount}`)).toBeVisible();
      await expect(page.getByTestId(`denom-${amount}`)).toBeEnabled();
    }
    for (const amount of ["10", "50", "100"]) {
      await expect(page.getByTestId(`denom-${amount}`)).toBeVisible();
      await expect(page.getByTestId(`denom-${amount}`)).toBeDisabled();
      await expect(page.getByTestId(`denom-${amount}`)).toHaveAttribute("data-status", "soon");
    }
    await expect(page.getByRole("switch", { name: "Private route send mode" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Private route send mode" })).toBeDisabled();
    for (const source of ["ethereum", "arbitrum", "base", "solana", "stellar"]) {
      await expect(page.getByTestId(`source-${source}`)).toBeDisabled();
    }
    // Mainnet Starknet escrow is intentionally unavailable until the verified
    // router/pool/indexer/evidence gate passes; do not make a route selectable
    // merely because Ready's standalone private pool is available.
    await expect(page.getByTestId("source-starknet")).toBeDisabled();
    await expect(page.getByTestId("handle-input")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Shield / })).toHaveCount(0);
    await expect(page.getByTestId("connect-source")).toContainText("Connect Ready wallet");
  });

  test("Inbox blocks without reading testnet notes or intents", async ({ page }) => {
    const testnetReads: string[] = [];
    page.on("request", (request) => {
      if (/\/v1\/(notes|intents)/.test(request.url())) testnetReads.push(request.url());
    });
    await page.goto("/inbox");
    await expect(page.getByText("Inbox is not available on Mainnet")).toBeVisible();
    await expect(page.getByRole("link", { name: "View Mainnet balance" })).toHaveAttribute(
      "href",
      "/account?tab=wallet",
    );
    expect(testnetReads).toEqual([]);
  });

  test("Claim blocks without mounting a claim action", async ({ page }) => {
    await page.goto("/claim");
    await expect(page.getByText("Claim is not available on Mainnet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim privately" })).toHaveCount(0);
  });
});
