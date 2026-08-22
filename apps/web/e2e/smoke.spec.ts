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
  await expect(page.getByTestId("denom-1")).toContainText("USDT0");
});

test("balance route redirects to Account", async ({ page }) => {
  await page.goto("/balance");
  await expect(page).toHaveURL(/\/account\/?(\?|$)/);
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
});

test("withdraw route redirects to Claim", async ({ page }) => {
  await page.goto("/withdraw");
  await expect(page).toHaveURL(/\/claim\/?(\?|$)/);
});

test("privacy page honest labels", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText(/simulated/i)).toBeVisible();
});
