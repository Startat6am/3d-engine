import { expect, test } from '@playwright/test';

test('Physics Playground loads Rapier WASM and exposes real simulation controls', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5174/physics-playground.html');
  await expect(page.locator('#renderer-state')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#physics-wasm')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#playground-status')).toHaveText('RUNNING');
  await expect(page.locator('#body-count')).toHaveText('5 bodies');

  const initialPosition = await page.locator('#player-position').textContent();
  const initialZ = Number(initialPosition?.match(/Z (-?\d+\.\d+)/)?.[1]);
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Z (-?\d+\.\d+)/)?.[1]);
    })
    .toBeLessThan(initialZ - 0.05);

  await page.getByRole('button', { name: 'Raycast' }).click();
  await expect(page.locator('#raycast-result')).toContainText('Hit entity');

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#playground-status')).toHaveText('PAUSED');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(page.locator('#playground-status')).toHaveText('PAUSED · STEP COMPLETE');

  await page.getByRole('button', { name: 'Resume' }).click();
  const beforeMouseJump = await page.locator('#player-position').textContent();
  const initialY = Number(beforeMouseJump?.match(/Y (-?\d+\.\d+)/)?.[1]);
  await page.locator('#playground-canvas').click();
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Y (-?\d+\.\d+)/)?.[1]);
    })
    .toBeGreaterThan(initialY + 0.1);

  await page.setViewportSize({ width: 360, height: 780 });

  await expect(page.getByRole('button', { name: 'Move forward' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move left' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move backward' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move right' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jump' })).toBeVisible();

  const beforeTouchMove = await page.locator('#player-position').textContent();
  const beforeTouchZ = Number(beforeTouchMove?.match(/Z (-?\\d+\\.\\d+)/)?.[1]);
  const forwardButton = page.getByRole('button', { name: 'Move forward' });
  await forwardButton.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true });
  await page.waitForTimeout(400);
  await forwardButton.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true });
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Z (-?\\d+\\.\\d+)/)?.[1]);
    })
    .toBeLessThan(beforeTouchZ - 0.03);

  const beforeTouchJump = await page.locator('#player-position').textContent();
  const beforeTouchY = Number(beforeTouchJump?.match(/Y (-?\\d+\\.\\d+)/)?.[1]);
  const jumpButton = page.getByRole('button', { name: 'Jump' });
  await jumpButton.dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'touch', isPrimary: true });
  await jumpButton.dispatchEvent('pointerup', { pointerId: 8, pointerType: 'touch', isPrimary: true });
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Y (-?\\d+\\.\\d+)/)?.[1]);
    })
    .toBeGreaterThan(beforeTouchY + 0.1);

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
