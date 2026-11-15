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

test('player shutdown releases renderer GPU resources and stops its frame loop', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as {
      __deletedBuffers: number;
      __deletedPrograms: number;
      __drawCalls: number;
    };
    state.__deletedBuffers = 0;
    state.__deletedPrograms = 0;
    state.__drawCalls = 0;

    const deleteBuffer = WebGL2RenderingContext.prototype.deleteBuffer;
    WebGL2RenderingContext.prototype.deleteBuffer = function (buffer) {
      state.__deletedBuffers += 1;
      return deleteBuffer.call(this, buffer);
    };
    const deleteProgram = WebGL2RenderingContext.prototype.deleteProgram;
    WebGL2RenderingContext.prototype.deleteProgram = function (program) {
      state.__deletedPrograms += 1;
      return deleteProgram.call(this, program);
    };
    const drawElements = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (mode, count, type, offset) {
      state.__drawCalls += 1;
      return drawElements.call(this, mode, count, type, offset);
    };
  });

  await page.goto('http://127.0.0.1:5174');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __drawCalls: number }).__drawCalls))
    .toBeGreaterThanOrEqual(4);

  const beforeDispose = await page.evaluate(() => {
    const state = window as unknown as {
      __deletedBuffers: number;
      __deletedPrograms: number;
    };
    return { ...state };
  });

  // Exercise the same pagehide handler used by a real browser navigation while
  // keeping the page alive long enough to observe WebGL resource deletion.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __deletedBuffers: number }).__deletedBuffers),
    )
    .toBeGreaterThan(beforeDispose.__deletedBuffers);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __deletedPrograms: number }).__deletedPrograms),
    )
    .toBeGreaterThan(beforeDispose.__deletedPrograms);

  // Let any frame already in flight when pagehide was dispatched finish, then
  // prove that the cancelled loop does not schedule another frame.
  await page.waitForTimeout(100);
  const settledDrawCalls = await page.evaluate(
    () => (window as unknown as { __drawCalls: number }).__drawCalls,
  );
  await page.waitForTimeout(100);
  const afterDisposeDrawCalls = await page.evaluate(
    () => (window as unknown as { __drawCalls: number }).__drawCalls,
  );
  expect(afterDisposeDrawCalls).toBe(settledDrawCalls);
  expect(pageErrors).toEqual([]);
});
