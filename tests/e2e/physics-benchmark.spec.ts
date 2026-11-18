import { expect, test } from '@playwright/test';

test('browser physics benchmark runs against the production Rapier WASM backend', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5174/physics-benchmark.html');
  await expect(page.locator('#benchmark-status')).toHaveAttribute('data-state', 'ready', {
    timeout: 60_000,
  });
  const report = JSON.parse((await page.locator('#benchmark-results').textContent()) ?? '{}') as {
    runtime: string;
    userAgent: string;
    wasmInitializationMs: number;
    sparseScenarios: Array<{
      bodies: number;
      fixedStep: { p95Ms: number };
      raycast: { p95Ms: number };
    }>;
    denseContact: {
      bodies: number;
      collisionEventsDrained: number;
      fixedStep: { p95Ms: number };
      raycastAll: { p95Ms: number };
    };
  };
  expect(report.runtime).toContain('Rapier WASM');
  expect(report.userAgent).toContain('Chrome');
  expect(report.wasmInitializationMs).toBeGreaterThan(0);
  expect(report.sparseScenarios.map((scenario) => scenario.bodies)).toEqual([100, 500, 1_000]);
  expect(report.sparseScenarios.every((scenario) => scenario.fixedStep.p95Ms >= 0)).toBe(true);
  expect(report.sparseScenarios.every((scenario) => scenario.raycast.p95Ms >= 0)).toBe(true);
  expect(report.denseContact.bodies).toBe(216);
  expect(report.denseContact.collisionEventsDrained).toBeGreaterThan(0);
  expect(report.denseContact.fixedStep.p95Ms).toBeGreaterThan(0);
  expect(report.denseContact.raycastAll.p95Ms).toBeGreaterThanOrEqual(0);
});
