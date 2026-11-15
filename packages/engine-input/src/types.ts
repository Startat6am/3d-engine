export type InputSource = 'keyboard' | 'mouse' | 'gamepad';
export type InputActionKind = 'button' | 'axis1D' | 'axis2D';
export type InputAxis = 'x' | 'y';

export interface InputActionDefinition {
  readonly name: string;
  readonly kind: InputActionKind;
}

export interface InputBinding {
  readonly action: string;
  readonly source: InputSource;
  readonly control: string;
  readonly scale?: number;
  readonly component?: InputAxis;
  readonly deadZone?: number;
  /** One-shot value accumulated until the next fixed tick (defaults for mouse deltas/wheel). */
  readonly transient?: boolean;
  readonly modifiers?: readonly string[];
}

export interface InputMap {
  readonly id: string;
  readonly actions: readonly InputActionDefinition[];
  readonly bindings: readonly InputBinding[];
}

export interface InputContext {
  readonly id: string;
  readonly map: InputMap;
  readonly priority: number;
  readonly consumeLowerPriority?: boolean;
}

export interface InputControlTransition {
  readonly source: InputSource;
  readonly control: string;
  readonly pressed: boolean;
}

export interface InputDeviceSample {
  readonly source: InputSource;
  readonly values: ReadonlyMap<string, number>;
  readonly transitions: readonly InputControlTransition[];
  readonly overflowed?: boolean;
}

export interface InputDeviceAdapter {
  sample(): readonly InputDeviceSample[];
  dispose(): void;
}

export interface InputSnapshot {
  isPressed(action: string): boolean;
  wasPressed(action: string): boolean;
  wasReleased(action: string): boolean;
  getAxis1D(action: string): number;
  getAxis2D(action: string): readonly [number, number];
}

export class InputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'InputError';
  }
}
