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

  await page.setViewportSize({ width: 360, height: 780 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
