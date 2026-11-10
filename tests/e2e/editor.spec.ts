import { expect, test } from '@playwright/test';

test('editor shell loads with a 3D viewport and hierarchy', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Universal 3D Engine/);
  await expect(page.getByText('HIERARCHY')).toBeVisible();
  await expect(page.locator('.tree-row.entity-row').filter({ hasText: 'Box' })).toBeVisible();
  await expect(page.getByLabel('3D scene viewport')).toBeVisible();
  await expect(page.getByLabel('3D scene viewport')).toHaveAttribute('data-renderer', 'webgl2');
});

test('editor remains usable on a 360px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');

  await expect(page.getByLabel('3D scene viewport')).toBeVisible();
  await expect(page.getByText('HIERARCHY')).toBeVisible();
  await expect(page.getByText('INSPECTOR')).toBeVisible();
  await expect(page.getByText('File ▾')).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    canvasWidth: document.querySelector('canvas')?.getBoundingClientRect().width ?? 0,
  }));
  expect(dimensions.pageWidth).toBe(dimensions.viewportWidth);
  expect(dimensions.canvasWidth).toBeGreaterThan(300);

  await page.getByLabel('Position X').fill('2.5');
  await page.getByLabel('Position X').press('Enter');
  await expect(page.getByLabel('Position X')).toHaveValue('2.5');
});

test('hierarchy plus opens a primitive picker instead of silently adding a box', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Add object' }).click();
  const menu = page.locator('#hierarchy-add-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: /Sphere/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Plane/ })).toBeVisible();

  await menu.getByRole('button', { name: /Sphere/ }).click();
  await expect(page.locator('.tree-row.entity-row').filter({ hasText: 'Sphere' })).toBeVisible();
  await expect(menu).toHaveCount(0);
});

test('two-finger pinch changes camera zoom without horizontal page scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.setPointerCapture = () => {};
  });
  await page.goto('/');
  const viewport = page.getByLabel('3D scene viewport');
  const before = Number(await viewport.getAttribute('data-camera-radius'));

  await viewport.dispatchEvent('pointerdown', {
    pointerId: 11,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 100,
    clientY: 300,
  });
  await viewport.dispatchEvent('pointerdown', {
    pointerId: 12,
    pointerType: 'touch',
    isPrimary: false,
    button: 0,
    clientX: 200,
    clientY: 300,
  });
  await viewport.dispatchEvent('pointermove', {
    pointerId: 12,
    pointerType: 'touch',
    isPrimary: false,
    button: 0,
    clientX: 250,
    clientY: 300,
  });
  await expect
    .poll(async () => Number(await viewport.getAttribute('data-camera-radius')))
    .toBeLessThan(before);
  await viewport.dispatchEvent('pointerup', { pointerId: 12, pointerType: 'touch' });
  await viewport.dispatchEvent('pointerup', { pointerId: 11, pointerType: 'touch' });

  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.pageWidth).toBe(dimensions.viewportWidth);
});

test('mobile transform pad nudges the selected object on the chosen axis', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await expect(page.getByLabel('Position X')).toHaveValue('0');

  await page.getByRole('button', { name: 'Increase X' }).click();
  await expect(page.getByLabel('Position X')).toHaveValue('0.1');

  await page.getByRole('button', { name: 'Rotate mode' }).click();
  await page.getByRole('button', { name: 'Y axis' }).click();
  await page.getByRole('button', { name: 'Increase Y' }).click();
  await expect(page.getByLabel('rotation Y')).toHaveValue('15');

  await page.getByRole('button', { name: 'Scale mode' }).click();
  await page.getByRole('button', { name: 'Increase Y' }).click();
  await expect(page.getByLabel('scale Y')).toHaveValue('1.1');
});
