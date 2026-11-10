import * as THREE from 'three';
import { validateMeshData } from '@engine/geometry';
import type {
  RendererAdapter,
  RendererCapabilities,
  RendererOptions,
  RenderScene,
  RenderObject,
} from './contracts.js';
import { RendererError } from './contracts.js';
export * from './contracts.js';

/** Three.js is deliberately contained behind this adapter; no Three.js types escape the package API. */
export class ThreeWebGLRendererAdapter implements RendererAdapter {
  readonly capabilities: RendererCapabilities;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #perspectiveCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  readonly #objects = new Map<string, THREE.Mesh>();
  readonly #raycaster = new THREE.Raycaster();
  #activeCamera: THREE.Camera | null = null;
  #disposed = false;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    try {
      const context = canvas.getContext('webgl2', {
        antialias: options.antialias ?? true,
        alpha: false,
      });
      if (!context)
        throw new RendererError(
          'WEBGL2_UNAVAILABLE',
          'WebGL2 is unavailable in this browser or canvas',
        );
      this.#renderer = new THREE.WebGLRenderer({
        canvas,
        context,
        antialias: options.antialias ?? true,
        alpha: false,
      });
    } catch (error) {
      if (error instanceof RendererError) throw error;
      throw new RendererError('WEBGL2_UNAVAILABLE', 'Failed to initialize WebGL2 renderer', {
        cause: error,
      });
    }
    this.#renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, options.pixelRatioCap ?? 2),
    );
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.5));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(4, 6, 3);
    this.#scene.add(light);
    this.capabilities = {
      backend: 'webgl2',
      maxTextureSize: this.#renderer.capabilities.maxTextureSize,
      maxSamples: this.#renderer.capabilities.maxSamples,
    };
  }

  resize(width: number, height: number): void {
    this.#assertActive();
    const w = Math.max(1, Math.floor(width)),
      h = Math.max(1, Math.floor(height));
    this.#renderer.setSize(w, h, false);
    this.#perspectiveCamera.aspect = w / h;
    this.#perspectiveCamera.updateProjectionMatrix();
  }

  render(scene: RenderScene): void {
    this.#assertActive();
    this.#syncObjects(scene.objects);
    this.#scene.background = new THREE.Color(scene.background);
    const camera = this.#applyCamera(scene.camera);
    this.#activeCamera = camera;
    this.#renderer.render(this.#scene, camera);
  }

  pick(x: number, y: number, width: number, height: number): string | null {
    this.#assertActive();
    const camera = this.#activeCamera;
    if (!camera || width <= 0 || height <= 0) return null;
    const pointer = new THREE.Vector2((x / width) * 2 - 1, 1 - (y / height) * 2);
    camera.updateMatrixWorld();
    this.#scene.updateMatrixWorld(true);
    this.#raycaster.setFromCamera(pointer, camera);
    const intersections = this.#raycaster.intersectObjects([...this.#objects.values()], false);
    const entityId = intersections[0]?.object.userData['engineEntityId'];
    return typeof entityId === 'string' ? entityId : null;
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const mesh of this.#objects.values()) this.#disposeMesh(mesh);
    this.#objects.clear();
    this.#renderer.dispose();
    this.#disposed = true;
  }

  #syncObjects(objects: readonly RenderObject[]): void {
    const live = new Set(objects.map((item) => item.id));
    for (const [id, mesh] of this.#objects)
      if (!live.has(id)) {
        this.#disposeMesh(mesh);
        this.#objects.delete(id);
      }
    for (const item of objects) {
      validateMeshData(item.geometry);
      let mesh = this.#objects.get(item.id);
      if (!mesh) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(item.geometry.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(item.geometry.normals, 3));
        geometry.setIndex(new THREE.BufferAttribute(item.geometry.indices, 1));
        mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
        mesh.userData['engineEntityId'] = item.id;
        this.#objects.set(item.id, mesh);
        this.#scene.add(mesh);
      } else {
        const geometry = mesh.geometry;
        if (
          geometry.getAttribute('position').array !== item.geometry.positions ||
          geometry.index?.array !== item.geometry.indices
        ) {
          geometry.dispose();
          const replacement = new THREE.BufferGeometry();
          replacement.setAttribute(
            'position',
            new THREE.BufferAttribute(item.geometry.positions, 3),
          );
          replacement.setAttribute('normal', new THREE.BufferAttribute(item.geometry.normals, 3));
          replacement.setIndex(new THREE.BufferAttribute(item.geometry.indices, 1));
          mesh.geometry = replacement;
        }
      }
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.setHex(item.material.color);
      material.roughness = item.material.roughness;
      material.metalness = item.material.metalness;
      material.opacity = item.material.opacity;
      material.transparent = item.material.transparent;
      material.wireframe = item.material.wireframe;
      mesh.position.set(...item.position);
      mesh.quaternion.set(...item.rotation);
      mesh.scale.set(...item.scale);
    }
  }

  #applyCamera(camera: RenderScene['camera']): THREE.Camera {
    if (camera.projection === 'perspective') {
      this.#perspectiveCamera.fov = camera.fovY ?? 60;
      this.#perspectiveCamera.near = camera.near;
      this.#perspectiveCamera.far = camera.far;
      this.#perspectiveCamera.position.set(...camera.position);
      this.#perspectiveCamera.quaternion.set(...camera.rotation);
      this.#perspectiveCamera.updateProjectionMatrix();
      return this.#perspectiveCamera;
    } else {
      const height = camera.orthographicHeight ?? 10,
        width = height * this.#perspectiveCamera.aspect;
      const orthographic = new THREE.OrthographicCamera(
        -width / 2,
        width / 2,
        height / 2,
        -height / 2,
        camera.near,
        camera.far,
      );
      orthographic.position.set(...camera.position);
      orthographic.quaternion.set(...camera.rotation);
      orthographic.updateProjectionMatrix();
      return orthographic;
    }
  }

  #disposeMesh(mesh: THREE.Mesh): void {
    this.#scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  #assertActive(): void {
    if (this.#disposed) throw new RendererError('DISPOSED', 'Renderer has been disposed');
  }
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  options?: RendererOptions,
): RendererAdapter {
  return new ThreeWebGLRendererAdapter(canvas, options);
}
