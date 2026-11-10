import type { MeshData } from '@engine/geometry';

export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];
export interface CameraDescriptor {
  readonly projection: 'perspective' | 'orthographic';
  readonly position: Vec3;
  readonly rotation: Quaternion;
  readonly near: number;
  readonly far: number;
  readonly fovY?: number;
  readonly orthographicHeight?: number;
}
export interface MaterialDescriptor {
  readonly color: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly opacity: number;
  readonly transparent: boolean;
  readonly wireframe: boolean;
}
export interface RenderObject {
  readonly id: string;
  readonly geometry: MeshData;
  readonly material: MaterialDescriptor;
  readonly position: Vec3;
  readonly rotation: Quaternion;
  readonly scale: Vec3;
}
export interface RenderScene {
  readonly camera: CameraDescriptor;
  readonly objects: readonly RenderObject[];
  readonly background: number;
}
export interface RendererCapabilities {
  readonly backend: 'webgl2';
  readonly maxTextureSize: number;
  readonly maxSamples: number;
}
export interface RendererAdapter {
  readonly capabilities: RendererCapabilities;
  resize(width: number, height: number): void;
  render(scene: RenderScene): void;
  dispose(): void;
}
export interface RendererOptions {
  readonly antialias?: boolean;
  readonly pixelRatioCap?: number;
}
export type RendererErrorCode =
  'WEBGL2_UNAVAILABLE' | 'CONTEXT_LOST' | 'INVALID_SCENE' | 'DISPOSED';
export class RendererError extends Error {
  constructor(
    readonly code: RendererErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RendererError';
  }
}

export function createDefaultCamera(): CameraDescriptor {
  return {
    projection: 'perspective',
    position: [3, 2.5, 4],
    rotation: lookAtQuaternion([3, 2.5, 4], [0, 0, 0]),
    near: 0.1,
    far: 1000,
    fovY: 60,
  };
}
export function createDefaultMaterial(color = 0x6ea8fe): MaterialDescriptor {
  return { color, roughness: 0.7, metalness: 0, opacity: 1, transparent: false, wireframe: false };
}
export function lookAtQuaternion(position: Vec3, target: Vec3): Quaternion {
  const [px, py, pz] = position,
    [tx, ty, tz] = target;
  const z = normalize([px - tx, py - ty, pz - tz]);
  const x = normalize(cross([0, 1, 0], z));
  const y = cross(z, x);
  const m00 = x[0],
    m01 = y[0],
    m02 = z[0],
    m10 = x[1],
    m11 = y[1],
    m12 = z[1],
    m20 = x[2],
    m21 = y[2],
    m22 = z[2];
  const trace = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return [qx, qy, qz, qw];
}
function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  if (length < 1e-8) throw new RangeError('Cannot normalize a zero-length vector');
  return [v[0] / length, v[1] / length, v[2] / length];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
