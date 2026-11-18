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
  const releasedZ = Number(
    (await page.locator('#player-position').textContent())?.match(/Z (-?\d+\.\d+)/)?.[1],
  );
  await page.waitForTimeout(180);
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Z (-?\d+\.\d+)/)?.[1]);
    })
    .toBeCloseTo(releasedZ, 2);

  await page.getByRole('button', { name: 'Raycast' }).click();
  await expect(page.locator('#raycast-result')).toContainText('Hit entity');

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#playground-status')).toHaveText('PAUSED');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(page.locator('#playground-status')).toHaveText('PAUSED · STEP COMPLETE');

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Reset scene' })).toBeEnabled();
  await page.getByRole('button', { name: 'Reset scene' }).click();
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Z (-?\d+\.\d+)/)?.[1]);
    })
    .toBeCloseTo(0, 1);
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Y (-?\d+\.\d+)/)?.[1]);
    })
    .toBeCloseTo(0.5, 1);

  await page.setViewportSize({ width: 360, height: 780 });

  await expect(page.getByRole('button', { name: 'Move forward' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move left' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move backward' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move right' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jump' })).toBeVisible();

  const beforeTouchMove = await page.locator('#player-position').textContent();
  const beforeTouchZ = Number(beforeTouchMove?.match(/Z (-?\d+\.\d+)/)?.[1]);
  const forwardButton = page.getByRole('button', { name: 'Move forward' });
  await forwardButton.dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
  });
  await page.waitForTimeout(400);
  await forwardButton.dispatchEvent('pointerup', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
  });
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Z (-?\d+\.\d+)/)?.[1]);
    })
    .toBeLessThan(beforeTouchZ - 0.03);
  const afterTouchMove = await page.locator('#player-position').textContent();
  const touchTravel = beforeTouchZ - Number(afterTouchMove?.match(/Z (-?\d+\.\d+)/)?.[1]);
  await expect(forwardButton).toHaveAttribute('data-pressed', 'false');
  expect(touchTravel).toBeLessThanOrEqual(0.4);

  await page.getByRole('button', { name: 'Reset scene' }).click();
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Z (-?\d+\.\d+)/)?.[1]);
    })
    .toBeCloseTo(0, 1);
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Y (-?\d+\.\d+)/)?.[1]);
    })
    .toBeCloseTo(0.5, 1);

  const beforeTouchJump = await page.locator('#player-position').textContent();
  const beforeTouchY = Number(beforeTouchJump?.match(/Y (-?\d+\.\d+)/)?.[1]);
  const jumpButton = page.getByRole('button', { name: 'Jump' });
  await jumpButton.click();
  let peakTouchJumpY = beforeTouchY;
  for (let frame = 0; frame < 35; frame += 1) {
    if (frame === 6) await jumpButton.click();
    await page.waitForTimeout(20);
    const current = await page.locator('#player-position').textContent();
    peakTouchJumpY = Math.max(
      peakTouchJumpY,
      Number(current?.match(/Y (-?\d+\.\d+)/)?.[1] ?? beforeTouchY),
    );
  }
  expect(peakTouchJumpY - beforeTouchY).toBeGreaterThan(0.1);
  expect(peakTouchJumpY - beforeTouchY).toBeLessThan(0.8);

  await page.getByRole('button', { name: 'Reset scene' }).click();
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Z (-?\d+\.\d+)/)?.[1]);
    })
    .toBeCloseTo(0, 1);
  await expect(page.locator('#playground-status')).toContainText('SCENE RESET');
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.getByRole('button', { name: 'Reset scene' })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
