import { expect, test } from "@playwright/test";

test("playground renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proompter playground");
});
