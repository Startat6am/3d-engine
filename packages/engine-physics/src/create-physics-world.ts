import type { PhysicsWorld, Vec3 } from './types.js';
import { RapierPhysicsWorld } from './rapier-world.js';

export interface PhysicsWorldOptions {
  readonly gravity?: Vec3;
}

/** Creates the configured browser physics backend without exposing vendor objects. */
export async function createPhysicsWorld(options: PhysicsWorldOptions = {}): Promise<PhysicsWorld> {
  return RapierPhysicsWorld.create(options);
}
