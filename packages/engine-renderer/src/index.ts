import * as THREE from 'three';
import type { MeshData } from '@engine/geometry';

export interface RendererCapabilities {
  readonly backend: 'webgl2';
  readonly maxTextureSize: number;
}

export interface RenderableMesh {
  readonly geometry: MeshData;
  readonly color?: number;
  readonly position?: readonly [number, number, number];
}

/** Three.js is deliberately contained behind this adapter; no Three.js types escape. */
export class ThreeWebGLRendererAdapter {
  readonly capabilities: RendererCapabilities;
  #renderer: THREE.WebGLRenderer;
  #scene = new THREE.Scene();
  #camera: THREE.PerspectiveCamera;
  #meshes: THREE.Mesh[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.#camera.position.set(3, 2.5, 4);
    this.#camera.lookAt(0, 0, 0);
    this.#scene.background = new THREE.Color(0x151a23);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(4, 6, 3);
    this.#scene.add(light);
    this.capabilities = {
      backend: 'webgl2',
      maxTextureSize: this.#renderer.capabilities.maxTextureSize,
    };
  }

  setMeshes(items: readonly RenderableMesh[]): void {
    for (const mesh of this.#meshes) {
      this.#scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.#meshes = items.map((item) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(item.geometry.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(item.geometry.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(item.geometry.indices, 1));
      const material = new THREE.MeshStandardMaterial({
        color: item.color ?? 0x6ea8fe,
        roughness: 0.7,
      });
      const mesh = new THREE.Mesh(geometry, material);
      if (item.position) mesh.position.set(...item.position);
      this.#scene.add(mesh);
      return mesh;
    });
  }

  resize(width: number, height: number): void {
    const safeWidth = Math.max(1, width),
      safeHeight = Math.max(1, height);
    this.#renderer.setSize(safeWidth, safeHeight, false);
    this.#camera.aspect = safeWidth / safeHeight;
    this.#camera.updateProjectionMatrix();
  }

  render(): void {
    this.#renderer.render(this.#scene, this.#camera);
  }

  dispose(): void {
    this.setMeshes([]);
    this.#renderer.dispose();
  }
}
