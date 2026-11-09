import { expect, test } from '@playwright/test';

test('editor shell loads with a 3D viewport and hierarchy', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Universal 3D Engine/);
  await expect(page.getByText('HIERARCHY')).toBeVisible();
  await expect(page.getByRole('button', { name: /Box/ })).toBeVisible();
  await expect(page.getByLabel('3D scene viewport')).toBeVisible();
});
