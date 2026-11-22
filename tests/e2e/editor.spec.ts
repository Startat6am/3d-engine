import { expect, test } from '@playwright/test';

test('editor shell loads with a 3D viewport and hierarchy', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Choreon/);
  await expect(page.getByText('HIERARCHY ＋', { exact: true })).toBeVisible();
  await expect(page.locator('.tree-row.entity-row')).toHaveCount(0);
  await expect(page.getByText('Empty scene')).toBeVisible();
  await expect(page.getByLabel('3D scene viewport')).toBeVisible();
  await expect(page.getByLabel('3D scene viewport')).toHaveAttribute('data-renderer', 'webgl2');
  await expect.poll(() => page.getByLabel('Frames per second').textContent()).toMatch(/^FPS \d+$/);
});

test('editor remains usable on a 360px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');

  await expect(page.getByLabel('3D scene viewport')).toBeVisible();
  await expect(page.getByText('HIERARCHY ＋', { exact: true })).toBeVisible();
  await expect(page.getByText('INSPECTOR')).toBeVisible();
  await expect(page.getByText('File ▾')).toBeVisible();
  await expect(page.getByText('Empty scene')).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    canvasWidth: document.querySelector('canvas')?.getBoundingClientRect().width ?? 0,
  }));
  expect(dimensions.pageWidth).toBe(dimensions.viewportWidth);
  expect(dimensions.canvasWidth).toBeGreaterThan(300);

  await page.getByRole('button', { name: 'Add object' }).click();
  await page.locator('#hierarchy-add-menu').getByRole('button', { name: /^Box/ }).click();
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
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.locator('#hierarchy-add-menu').getByRole('button', { name: /^Box/ }).click();
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

test('mobile transform controls dock at the bottom in one compact row', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const viewport = page.getByLabel('3D scene viewport');
  const panel = page.getByLabel('Transform controls');
  const panelBox = await panel.boundingBox();
  const viewportBox = await viewport.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(viewportBox).not.toBeNull();
  expect(panelBox!.height).toBeLessThanOrEqual(60);
  expect(panelBox!.y).toBeGreaterThan(viewportBox!.y + viewportBox!.height * 0.65);
  await expect(page.getByRole('button', { name: 'Move mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Increase X' })).toBeVisible();
});

test('mobile transform panel collapses to a small translucent toggle and expands again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const panel = page.getByLabel('Transform controls');
  await expect(page.getByRole('button', { name: 'Collapse transform panel' })).toHaveText('‹');

  await page.getByRole('button', { name: 'Collapse transform panel' }).click();
  await expect(page.getByRole('button', { name: 'Expand transform panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move mode' })).toHaveCount(0);
  const collapsedBox = await panel.boundingBox();
  expect(collapsedBox).not.toBeNull();
  expect(collapsedBox!.width).toBeLessThanOrEqual(22);
  expect(collapsedBox!.height).toBeLessThanOrEqual(44);
  await expect(page.getByRole('button', { name: 'Expand transform panel' })).toHaveText('›');
  expect(collapsedBox!.x).toBeLessThanOrEqual(10);

  await page.getByRole('button', { name: 'Expand transform panel' }).click();
  await expect(page.getByRole('button', { name: 'Move mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse transform panel' })).toBeVisible();
});

test('editor reports real renderer and save state without placeholder components', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.topbar .status')).toContainText('RENDERER ONLINE');
  await expect(page.getByText('NEW SCENE')).toBeVisible();
  await expect(page.getByText('COMPONENTS')).toHaveCount(0);
  await expect(page.getByText('Mesh Renderer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add object' }).click();
  await page
    .locator('#hierarchy-add-menu')
    .getByRole('button', { name: /Sphere/ })
    .click();
  await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();
  await page.locator('details.file-menu > summary').click();
  await page.getByRole('button', { name: 'Save World…' }).click();
  await expect(page.getByText('SAVED')).toBeVisible();
});

test('editor opens with an empty scene and shows an actionable state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Empty scene')).toBeVisible();
  await expect(
    page.getByText('Select an object or voxel chunk in the Hierarchy, or add content to begin.'),
  ).toBeVisible();
  await expect(page.getByText('0 OBJECTS', { exact: true })).toBeVisible();
});

test('editor creates project-backed voxel material assets and paints with them', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add object' }).click();
  await page
    .locator('#hierarchy-add-menu')
    .getByRole('button', { name: /Voxel chunk/ })
    .click();
  await page.getByLabel('New voxel material name').fill('Copper Alloy');
  await page.getByLabel('New voxel material color').fill('#b87333');
  await page.getByRole('button', { name: 'Create material' }).click();
  await expect(
    page.getByRole('button', { name: 'Select Copper Alloy voxel material' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select Copper Alloy voxel material' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Paint cell' }).click();
  await expect(page.getByText('Revision 1 · 1 materials')).toBeVisible();
  await expect(page.locator('.voxel-palette')).toContainText('Copper Alloy');
  await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();
});

test('editor can author and render a voxel chunk beside conventional mesh entities', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add object' }).click();
  const menu = page.locator('#hierarchy-add-menu');
  await menu.getByRole('button', { name: /Voxel chunk/ }).click();

  await expect(page.getByText('0 OBJECTS', { exact: true })).toBeVisible();
  await expect(page.getByText('1 VOXEL CHUNKS', { exact: true })).toBeVisible();
  await expect(page.getByLabel('3D scene viewport')).toHaveAttribute('data-renderer', 'webgl2');
  await expect(page.getByLabel('Voxel chunk editor')).toBeVisible();
  await expect(page.getByText('Revision 0 · 0 materials')).toBeVisible();

  const cellX = page.getByLabel('Voxel cell X');
  await cellX.fill('');
  await cellX.pressSequentially('5');
  await page.getByRole('button', { name: 'Select Grass voxel material' }).focus();
  await expect(cellX).toHaveValue('5');
  await cellX.fill('2');
  await page.getByLabel('Voxel cell Y').fill('2');
  await page.getByLabel('Voxel cell Z').fill('3');

  const chunkX = page.getByLabel('Chunk X');
  await chunkX.fill('2');
  await chunkX.press('Enter');
  await page.getByRole('button', { name: 'Move chunk' }).click();
  await expect(page.getByText('Chunk (2, 0, 0)')).toBeVisible();
  await expect(page.getByText('Revision 1 · 0 materials')).toBeVisible();

  await page.getByRole('button', { name: 'Paint cell' }).click();
  await expect(page.getByText('Revision 2 · 1 materials')).toBeVisible();
  await page.getByRole('button', { name: 'Select Stone voxel material' }).click();
  await page.getByRole('button', { name: 'Paint cell' }).click();
  await expect(page.getByText('Revision 3 · 2 materials')).toBeVisible();
  await expect(page.locator('.voxel-palette')).toContainText('Grass');
  await expect(page.locator('.voxel-palette')).toContainText('Stone');

  await page.getByRole('button', { name: 'Move stone up' }).click();
  await expect(page.getByText('Revision 4 · 2 materials')).toBeVisible();
  await expect(page.locator('.voxel-palette-entry').nth(0)).toContainText('Stone');
  await expect(page.locator('.voxel-palette-entry').nth(1)).toContainText('Grass');
  await expect(page.getByRole('button', { name: 'Move grass up' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Move stone down' })).toBeEnabled();

  await page.getByRole('button', { name: 'Erase cell' }).click();
  await expect(page.getByText('Revision 5 · 2 materials')).toBeVisible();
  await page.getByRole('button', { name: 'Remove stone' }).click();
  await expect(page.getByText('Revision 6 · 1 materials')).toBeVisible();
  await expect(page.locator('.voxel-palette')).toContainText('Grass');
  await expect(page.locator('.voxel-palette')).not.toContainText('Stone');

  await page.getByLabel('Y axis').click();
  await page.getByRole('button', { name: 'Increase Y' }).click();
  await expect(page.getByText('Chunk (2, 1, 0)')).toBeVisible();
  await expect(page.getByText('Revision 7 · 1 materials')).toBeVisible();
  await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();
});
