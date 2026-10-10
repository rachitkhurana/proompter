import { expect, test } from "@playwright/test";

test("playground renders the mock feed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Feed");
  await expect(page.getByTestId("post-avatar")).toBeVisible();
});
