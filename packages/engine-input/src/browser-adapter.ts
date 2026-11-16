import {
  InputError,
  type InputControlTransition,
  type InputDeviceAdapter,
  type InputDeviceSample,
  type InputSource,
} from './types.js';

/** Browser adapter for keyboard, mouse and standard Gamepad API controls. */
const MAX_PENDING_TRANSITIONS = 1024;

export class BrowserInputAdapter implements InputDeviceAdapter {
  readonly #window: Window;
  readonly #values = new Map<InputSource, Map<string, number>>([
    ['keyboard', new Map()],
    ['mouse', new Map()],
    ['gamepad', new Map()],
  ]);
  readonly #transitions: InputControlTransition[] = [];
  readonly #listeners: Array<() => void> = [];
  #disposed = false;
  #queueOverflowed = false;
  #mouseDeltaX = 0;
  #mouseDeltaY = 0;
  #wheel = 0;

  constructor(target: Window) {
    this.#window = target;
    this.#listen(target, 'keydown', ((event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      this.#set('keyboard', event.code, 1);
    }) as EventListener);
    this.#listen(target, 'keyup', ((event: KeyboardEvent) =>
      this.#set('keyboard', event.code, 0)) as EventListener);
    this.#listen(target, 'mousedown', ((event: MouseEvent) =>
      this.#set('mouse', `Button${event.button}`, 1)) as EventListener);
    this.#listen(target, 'mouseup', ((event: MouseEvent) =>
      this.#set('mouse', `Button${event.button}`, 0)) as EventListener);
    this.#listen(target, 'mousemove', ((event: MouseEvent) => {
      this.#mouseDeltaX += event.movementX;
      this.#mouseDeltaY += event.movementY;
    }) as EventListener);
    this.#listen(target, 'wheel', ((event: WheelEvent) => {
      this.#wheel += event.deltaY;
    }) as EventListener);
    this.#listen(target, 'blur', (() => this.#releaseAll()) as EventListener);
    this.#listen(target.document, 'visibilitychange', (() => {
      if (target.document.visibilityState !== 'visible') this.#releaseAll();
    }) as EventListener);
  }

  sample(): readonly InputDeviceSample[] {
    this.#assertActive();
    this.#pollGamepads();
    const transitions = this.#transitions.splice(0);
    const keyboard = new Map(this.#values.get('keyboard'));
    const mouse = new Map(this.#values.get('mouse'));
    mouse.set('DeltaX', this.#mouseDeltaX);
    mouse.set('DeltaY', this.#mouseDeltaY);
    mouse.set('Wheel', this.#wheel);
    this.#mouseDeltaX = this.#mouseDeltaY = this.#wheel = 0;
    return [
      {
        source: 'keyboard',
        values: keyboard,
        transitions: transitions.filter((t) => t.source === 'keyboard'),
        overflowed: this.#takeOverflow(),
      },
      {
        source: 'mouse',
        values: mouse,
        transitions: transitions.filter((t) => t.source === 'mouse'),
      },
      {
        source: 'gamepad',
        values: new Map(this.#values.get('gamepad')),
        transitions: transitions.filter((t) => t.source === 'gamepad'),
      },
    ];
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const remove of this.#listeners.splice(0)) remove();
    this.#releaseAll();
    for (const values of this.#values.values()) values.clear();
  }

  #listen(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    this.#listeners.push(() => target.removeEventListener(type, handler));
  }

  #set(source: InputSource, control: string, value: number): void {
    const values = this.#values.get(source)!;
    const previous = values.get(control) ?? 0;
    if (previous === value) return;
    if (previous > 0 !== value > 0 && (source !== 'gamepad' || control.includes(':Button'))) {
      if (this.#transitions.length >= MAX_PENDING_TRANSITIONS) this.#queueOverflowed = true;
      else this.#transitions.push({ source, control, pressed: value > 0 });
    }
    values.set(control, value);
  }

  #pollGamepads(): void {
    const getGamepads = this.#window.navigator.getGamepads?.bind(this.#window.navigator);
    if (!getGamepads) return;
    const values = this.#values.get('gamepad')!;
    const seen = new Set<string>();
    for (const gamepad of getGamepads()) {
      if (!gamepad?.connected) continue;
      gamepad.buttons.forEach((button, index) => {
        const control = `Gamepad${gamepad.index}:Button${index}`;
        seen.add(control);
        this.#set('gamepad', control, button.pressed ? 1 : button.value);
      });
      gamepad.axes.forEach((axis, index) => {
        const control = `Gamepad${gamepad.index}:Axis${index}`;
        seen.add(control);
        this.#set('gamepad', control, axis);
      });
    }
    for (const [control, value] of values)
      if (!seen.has(control) && value !== 0) this.#set('gamepad', control, 0);
  }

  #releaseAll(): void {
    // Discard relative input accumulated before focus was lost. Replaying stale
    // mouse motion or wheel input after returning to the tab feels like a jump.
    this.#mouseDeltaX = 0;
    this.#mouseDeltaY = 0;
    this.#wheel = 0;
    for (const source of ['keyboard', 'mouse', 'gamepad'] as const) {
      for (const [control, value] of this.#values.get(source)!) {
        if (value > 0) this.#set(source, control, 0);
      }
    }
  }

  #takeOverflow(): boolean {
    const overflowed = this.#queueOverflowed;
    this.#queueOverflowed = false;
    return overflowed;
  }

  #assertActive(): void {
    if (this.#disposed)
      throw new InputError('input.disposed', 'Browser input adapter has been disposed');
  }
}
