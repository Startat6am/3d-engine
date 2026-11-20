# Player Physics Playground

The Player physics playground provides a touch-friendly camera-orbit control for inspecting the physics scene.

## Camera orbit control

- Press and hold the camera button to enable orbit mode; release it to disable orbit mode.
- While the button is held, drag on the canvas to orbit the camera.
- The control supports pointer input, including touch and primary-mouse input. Pointer capture keeps the hold gesture active while the pointer moves away from the button; cancellation and release end the gesture.
- The camera button is shifted 45 CSS pixels to the left within the touch HUD to keep it clear of adjacent controls.
- The button exposes its state through `aria-pressed` and the `data-active` attribute. Its accessible label is “Hold to rotate camera”.

## Verification

The behavior is covered by `tests/e2e/physics-playground.spec.ts`. Run the focused browser test with:

```sh
pnpm exec playwright test tests/e2e/physics-playground.spec.ts
```
