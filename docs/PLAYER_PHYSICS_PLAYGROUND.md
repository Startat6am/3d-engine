# Player Physics Playground

The Player physics playground is a self-contained character and collision test course. It starts with a capsule character and a block-built voxel-style obstacle course; no project import is required.

## Character controller

- Move with **W/A/S/D** or the on-screen movement joystick. Use **Space** or the on-screen **JUMP** button to jump.
- The player uses a Rapier kinematic capsule (0.35 m radius, 0.55 m half-height) and the physics character-controller API. Gravity and jump velocity are integrated at the fixed 60 Hz simulation step.
- The obstacle course includes four consecutive 0.30 m rises, plus raised blocks and columns for testing top, side, and corner contacts.
- Autostep is enabled with a 0.34 m maximum step height and 0.22 m minimum width. The controller also uses slope limits and a short snap-to-ground distance.
- The character readout reports grounded/airborne state, horizontal speed, and the current contact count. Reset scene returns the character to its spawn point.

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
