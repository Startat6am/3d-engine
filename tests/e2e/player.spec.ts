import { expect, test } from '@playwright/test';

test('player renders the primitive acceptance scene through WebGL2', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, '__engineDrawCalls', { value: 0, writable: true });
    const original = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (mode, count, type, offset) {
      const target = window as unknown as { __engineDrawCalls: number };
      target.__engineDrawCalls += 1;
      return original.call(this, mode, count, type, offset);
    };
  });

  await page.goto('http://127.0.0.1:5174');
  const canvas = page.locator('#player');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __engineDrawCalls: number }).__engineDrawCalls),
    )
    .toBeGreaterThanOrEqual(4);
  const renderOutput = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) return { hasWebGl2: false, litPixels: 0 };
    const gl = element.getContext('webgl2');
    if (!gl) return { hasWebGl2: false, litPixels: 0 };
    const pixels = new Uint8Array(element.width * element.height * 4);
    gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let litPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== 21 || pixels[index + 1] !== 26 || pixels[index + 2] !== 35)
        litPixels += 1;
    }
    return { hasWebGl2: true, litPixels };
  });
  expect(renderOutput.hasWebGl2).toBe(true);
  expect(renderOutput.litPixels).toBeGreaterThan(500);
  expect(pageErrors).toEqual([]);
});
