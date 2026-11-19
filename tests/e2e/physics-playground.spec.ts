import { expect, test } from '@playwright/test';

test('Physics Playground loads Rapier WASM and exposes real simulation controls', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5174/physics-playground.html');
  await expect(page.locator('#renderer-state')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#physics-wasm')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#playground-status')).toHaveText('RUNNING');
  await expect(page.locator('#body-count')).toHaveText('5 bodies');
  await expect.poll(() => page.getByLabel('Frames per second').textContent()).toMatch(/^FPS \d+$/);

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

  const joystick = page.getByRole('group', { name: 'Movement joystick' });
  await expect(joystick).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jump' })).toBeVisible();
  const cameraButton = page.getByRole('button', { name: 'Toggle camera orbit mode' });
  await expect(cameraButton).toBeVisible();
  await expect(cameraButton).toHaveAttribute('aria-pressed', 'false');
  await cameraButton.click();
  await expect(cameraButton).toHaveAttribute('aria-pressed', 'true');
  await expect(cameraButton).toHaveAttribute('data-active', 'true');
  const beforeCameraDrag = await page.locator('#player-position').textContent();
  const beforeCameraXZ = beforeCameraDrag?.match(/X (-?\d+\.\d+).*Z (-?\d+\.\d+)/)?.slice(1);
  const canvas = page.locator('#playground-canvas');
  const initialCameraAzimuth = await canvas.getAttribute('data-camera-azimuth');
  const canvasBounds = await canvas.boundingBox();
  if (!canvasBounds) throw new Error('Playground canvas has no layout box');
  const dragStart = { x: canvasBounds.x + canvasBounds.width / 2, y: canvasBounds.y + 100 };
  await canvas.dispatchEvent('pointerdown', {
    pointerId: 91,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: dragStart.x,
    clientY: dragStart.y,
  });
  await canvas.dispatchEvent('pointermove', {
    pointerId: 91,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: dragStart.x + 120,
    clientY: dragStart.y - 35,
  });
  await canvas.dispatchEvent('pointerup', {
    pointerId: 91,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: dragStart.x + 120,
    clientY: dragStart.y - 35,
  });
  await expect(canvas).not.toHaveAttribute('data-camera-azimuth', initialCameraAzimuth ?? '');
  const afterCameraDrag = await page.locator('#player-position').textContent();
  const afterCameraXZ = afterCameraDrag?.match(/X (-?\d+\.\d+).*Z (-?\d+\.\d+)/)?.slice(1);
  expect(afterCameraXZ).toEqual(beforeCameraXZ);
  await cameraButton.click();
  await expect(cameraButton).toHaveAttribute('aria-pressed', 'false');
  await expect(cameraButton).toHaveAttribute('data-active', 'false');

  const beforeTouchMove = await page.locator('#player-position').textContent();
  const beforeTouchZ = Number(beforeTouchMove?.match(/Z (-?\d+\.\d+)/)?.[1]);
  const joystickBounds = await joystick.boundingBox();
  if (!joystickBounds) throw new Error('Movement joystick has no layout box');
  const joystickCenter = {
    x: joystickBounds.x + joystickBounds.width / 2,
    y: joystickBounds.y + joystickBounds.height / 2,
  };
  await joystick.dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    clientX: joystickCenter.x,
    clientY: joystickCenter.y,
  });
  await joystick.dispatchEvent('pointermove', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    clientX: joystickCenter.x,
    clientY: joystickCenter.y - 45,
  });
  await page.waitForTimeout(400);
  await joystick.dispatchEvent('pointerup', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    clientX: joystickCenter.x,
    clientY: joystickCenter.y - 45,
  });
  await expect
    .poll(async () => {
      const current = await page.locator('#player-position').textContent();
      return Number(current?.match(/Z (-?\d+\.\d+)/)?.[1]);
    })
    .toBeLessThan(beforeTouchZ - 0.03);
  const afterTouchMove = await page.locator('#player-position').textContent();
  const touchTravel = beforeTouchZ - Number(afterTouchMove?.match(/Z (-?\d+\.\d+)/)?.[1]);
  await expect(joystick).toHaveAttribute('data-active', 'false');
  expect(touchTravel).toBeGreaterThan(0.3);
  // Allow one additional fixed tick of browser scheduling jitter.
  expect(touchTravel).toBeLessThan(0.6);

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
  expect(peakTouchJumpY - beforeTouchY).toBeGreaterThan(0.25);
  expect(peakTouchJumpY - beforeTouchY).toBeLessThan(0.5);

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
