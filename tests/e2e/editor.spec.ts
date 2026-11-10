import { expect, test } from '@playwright/test';

test('editor shell loads with a 3D viewport and hierarchy', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Universal 3D Engine/);
  await expect(page.getByText('HIERARCHY')).toBeVisible();
  await expect(page.locator('.tree-row.entity-row').filter({ hasText: 'Box' })).toBeVisible();
  await expect(page.getByLabel('3D scene viewport')).toBeVisible();
  await expect(page.getByLabel('3D scene viewport')).toHaveAttribute('data-renderer', 'webgl2');
});
