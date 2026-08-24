import { test, expect } from "@playwright/test";

test("landing + Send shell", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Hold Anywhere/i }),
  ).toBeVisible();
  await page.goto("/send");
  await expect(page.getByText("1").first()).toBeVisible();
  await expect(page.getByTestId("denom-1")).toBeVisible();
  await expect(page.getByTestId("denom-100")).toBeVisible();
  await expect(page.getByTestId("denom-0.5")).toHaveCount(0);
  await expect(page.getByText(/admitted testnet source/i)).toBeVisible();
});

test("balance route shows private balance", async ({ page }) => {
  await page.goto("/balance");
  await expect(page.getByRole("heading", { level: 1, name: "Private balance" })).toBeVisible();
});

test("withdraw route redirects to Claim", async ({ page }) => {
  await page.goto("/withdraw");
  await expect(page).toHaveURL(/\/claim\/?(\?|$)/);
});

test("privacy page honest labels", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByTestId("privacy-page")).toContainText(/unaudited/i);
});

test("network dropdown confirms, persists, and restores shared Send state", async ({ page }) => {
  await page.goto("/send");
  const menuButton = page.getByTestId("network-menu");
  await expect(menuButton).toContainText("Testnet");

  await menuButton.click();
  const testnetToggle = page.getByRole("switch", { name: "Testnet mode" });
  await expect(testnetToggle).toBeChecked();
  await testnetToggle.click();
  await expect(
    page.getByRole("region", { name: "Network menu" }).getByRole("alert"),
  ).toContainText("Mainnet uses real USDC and STRK");
  await expect(menuButton).toContainText("Testnet");
  await expect(testnetToggle).toBeChecked();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Use mainnet" })).toHaveCount(0);
  await expect(menuButton).toContainText("Testnet");
  await testnetToggle.click();

  await page.getByRole("button", { name: "Use mainnet" }).click();
  await expect(menuButton).toContainText("Mainnet");
  await expect(page.getByTestId("denom-0.5")).toBeVisible();
  await expect(page.getByTestId("source-ethereum")).toBeDisabled();

  await page.reload();
  await expect(menuButton).toContainText("Mainnet");
  await expect(page.getByTestId("denom-0.5")).toBeVisible();

  await menuButton.click();
  await page.getByRole("switch", { name: "Testnet mode" }).click();
  await expect(menuButton).toContainText("Testnet");
  await expect(page.getByTestId("denom-0.5")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Private route send mode" })).not.toBeChecked();

  await menuButton.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Network menu" })).toHaveCount(0);
});

test.describe("Mainnet mode isolation", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("wotta-network-mode", "mainnet"));
  });

  test("Send keeps the shared form and restricts it to Starknet", async ({ page }) => {
    await page.goto("/send");
    await expect(page.getByRole("heading", { name: "Send", exact: true })).toBeVisible();
    for (const amount of ["0.5", "1", "10", "50", "100"]) {
      await expect(page.getByTestId(`denom-${amount}`)).toBeVisible();
    }
    await expect(page.getByRole("switch", { name: "Private route send mode" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Private route send mode" })).toBeDisabled();
    for (const source of ["ethereum", "arbitrum", "base", "solana", "stellar"]) {
      await expect(page.getByTestId(`source-${source}`)).toBeDisabled();
    }
    await expect(page.getByTestId("source-starknet")).toBeEnabled();
    await expect(page.getByTestId("handle-input")).toBeVisible();
    await expect(page.getByText(/selected amount plus a private-fee reserve/i)).toBeVisible();
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
    expect(testnetReads).toEqual([]);
  });

  test("Claim blocks without mounting a claim action", async ({ page }) => {
    await page.goto("/claim");
    await expect(page.getByText("Claim is not available on Mainnet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim privately" })).toHaveCount(0);
  });
});
