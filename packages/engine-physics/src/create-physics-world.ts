import type { PhysicsResourceLimits, PhysicsWorld, Vec3 } from './types.js';
import { RapierPhysicsWorld } from './rapier-world.js';

export interface PhysicsWorldOptions {
  readonly gravity?: Vec3;
  readonly limits?: Partial<PhysicsResourceLimits>;
}

/** Creates the configured browser physics backend without exposing vendor objects. */
export async function createPhysicsWorld(options: PhysicsWorldOptions = {}): Promise<PhysicsWorld> {
  return RapierPhysicsWorld.create(options);
}
