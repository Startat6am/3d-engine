import { expect, test } from '@playwright/test';

test('empty scene stays empty after viewport resize and page scroll', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Delete selected object' }).click();
  await expect(page.getByText('0 OBJECTS · SCENE 01')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.setViewportSize({ width: 1180, height: 680 });
  await expect(page.getByText('0 OBJECTS · SCENE 01')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('GLB import failures are reported in Console, not Hierarchy', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[accept=".glb,model/gltf-binary"]').setInputFiles({
    name: 'broken.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from('not a GLB file'),
  });
  await page.getByRole('button', { name: /Console/ }).click();
  await expect(page.getByText('Importer engine.gltf.glb failed', { exact: true })).toBeVisible();
  await expect(page.getByText(/broken.glb/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('1 OBJECTS · SCENE 01')).toBeVisible();
});
