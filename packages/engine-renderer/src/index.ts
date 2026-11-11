import * as THREE from 'three';
import { AssetResourceCache, type AssetResourceLease } from '@engine/assets';
import { validateMeshData } from '@engine/geometry';
import type {
  RendererAdapter,
  RendererCapabilities,
  RendererOptions,
  RenderScene,
  RenderObject,
  TextureSource,
} from './contracts.js';
import { RendererError } from './contracts.js';
export * from './contracts.js';

type TextureChannel = 'baseColor' | 'metallicRoughness' | 'normal' | 'occlusion' | 'emissive';

/** Three.js is deliberately contained behind this adapter; no Three.js types escape the package API. */
export class ThreeWebGLRendererAdapter implements RendererAdapter {
  readonly capabilities: RendererCapabilities;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #perspectiveCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  readonly #objects = new Map<
    string,
    {
      readonly mesh: THREE.Mesh;
      geometrySource: object;
      materialSource: object;
      geometryLease: AssetResourceLease<THREE.BufferGeometry>;
      materialLease: AssetResourceLease<THREE.MeshStandardMaterial>;
      textureSources: Map<TextureChannel, TextureSource>;
      textureLeases: Map<TextureChannel, AssetResourceLease<THREE.Texture>>;
      active: boolean;
    }
  >();
  readonly #geometryCache = new AssetResourceCache<THREE.BufferGeometry>();
  readonly #materialCache = new AssetResourceCache<THREE.MeshStandardMaterial>();
  readonly #textureCache = new AssetResourceCache<THREE.Texture>();
  readonly #geometryKeys = new WeakMap<object, string>();
  readonly #materialKeys = new WeakMap<object, string>();
  #nextResourceKey = 1;
  readonly #raycaster = new THREE.Raycaster();
  readonly #orthographicCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 1000);
  #activeCamera: THREE.Camera | null = null;
  #disposed = false;
  #lastScene: RenderScene | null = null;

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
    this.#lastScene = scene;
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
    const intersections = this.#raycaster.intersectObjects(
      [...this.#objects.values()].map((entry) => entry.mesh),
      false,
    );
    const entityId = intersections[0]?.object.userData['engineEntityId'];
    return typeof entityId === 'string' ? entityId : null;
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const entry of this.#objects.values()) this.#releaseObject(entry);
    this.#objects.clear();
    this.#lastScene = null;
    this.#scene.clear();
    this.#renderer.dispose();
    this.#disposed = true;
  }

  #syncObjects(objects: readonly RenderObject[]): void {
    const live = new Set(objects.map((item) => item.id));
    for (const [id, entry] of this.#objects)
      if (!live.has(id)) {
        this.#releaseObject(entry);
        this.#objects.delete(id);
      }
    for (const item of objects) {
      validateMeshData(item.geometry);
      let entry = this.#objects.get(item.id);
      const geometryKey = this.#keyFor(item.geometry, this.#geometryKeys, 'geometry');
      const materialKey = this.#keyFor(item.material, this.#materialKeys, 'material');
      if (!entry) {
        const geometryLease = this.#geometryCache.acquireSync(
          geometryKey,
          () => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
              'position',
              new THREE.BufferAttribute(item.geometry.positions, 3),
            );
            geometry.setAttribute('normal', new THREE.BufferAttribute(item.geometry.normals, 3));
            if (item.geometry.uvs) {
              const uv = new THREE.BufferAttribute(item.geometry.uvs, 2);
              geometry.setAttribute('uv', uv);
              geometry.setAttribute('uv2', uv);
            }
            geometry.setIndex(new THREE.BufferAttribute(item.geometry.indices, 1));
            return geometry;
          },
          (geometry) => geometry.dispose(),
        );
        let materialLease: AssetResourceLease<THREE.MeshStandardMaterial> | undefined;
        let mesh: THREE.Mesh;
        try {
          materialLease = this.#materialCache.acquireSync(
            materialKey,
            () => new THREE.MeshStandardMaterial(),
            (material) => material.dispose(),
          );
          mesh = new THREE.Mesh(geometryLease.resource, materialLease.resource);
          mesh.userData['engineEntityId'] = item.id;
        } catch (error) {
          materialLease?.release();
          geometryLease.release();
          throw error;
        }
        entry = {
          mesh,
          active: true,
          textureSources: new Map(),
          textureLeases: new Map(),
          geometrySource: item.geometry,
          materialSource: item.material,
          geometryLease,
          materialLease,
        };
        this.#objects.set(item.id, entry);
        this.#scene.add(mesh);
      } else {
        // Acquire replacements before releasing the current leases. If creating either
        // resource fails, the existing mesh remains valid and its leases stay intact.
        let nextGeometryLease: AssetResourceLease<THREE.BufferGeometry> | undefined;
        let nextMaterialLease: AssetResourceLease<THREE.MeshStandardMaterial> | undefined;
        try {
          if (entry.geometrySource !== item.geometry) {
            nextGeometryLease = this.#geometryCache.acquireSync(
              geometryKey,
              () => {
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute(
                  'position',
                  new THREE.BufferAttribute(item.geometry.positions, 3),
                );
                geometry.setAttribute(
                  'normal',
                  new THREE.BufferAttribute(item.geometry.normals, 3),
                );
                if (item.geometry.uvs) {
                  const uv = new THREE.BufferAttribute(item.geometry.uvs, 2);
                  geometry.setAttribute('uv', uv);
                  geometry.setAttribute('uv2', uv);
                }
                geometry.setIndex(new THREE.BufferAttribute(item.geometry.indices, 1));
                return geometry;
              },
              (geometry) => geometry.dispose(),
            );
          }
          if (entry.materialSource !== item.material) {
            nextMaterialLease = this.#materialCache.acquireSync(
              materialKey,
              () => new THREE.MeshStandardMaterial(),
              (material) => material.dispose(),
            );
          }
        } catch (error) {
          nextGeometryLease?.release();
          nextMaterialLease?.release();
          throw error;
        }
        if (nextGeometryLease) {
          const previousLease = entry.geometryLease;
          entry.geometryLease = nextGeometryLease;
          entry.geometrySource = item.geometry;
          entry.mesh.geometry = nextGeometryLease.resource;
          previousLease.release();
        }
        if (nextMaterialLease) {
          const previousLease = entry.materialLease;
          for (const textureLease of entry.textureLeases.values()) textureLease.release();
          entry.textureLeases.clear();
          entry.textureSources.clear();
          entry.materialLease = nextMaterialLease;
          entry.materialSource = item.material;
          entry.mesh.material = nextMaterialLease.resource;
          previousLease.release();
        }
      }
      const mesh = entry.mesh;
      const material = entry.materialLease.resource;
      material.color.setHex(item.material.color);
      material.roughness = item.material.roughness;
      material.metalness = item.material.metalness;
      material.opacity = item.material.opacity;
      material.transparent = item.material.transparent;
      material.wireframe = item.material.wireframe;
      material.emissive.setHex(item.material.emissiveColor ?? 0x000000);
      this.#syncTexture(entry, 'baseColor', item.material.baseColorTexture);
      this.#syncTexture(entry, 'metallicRoughness', item.material.metallicRoughnessTexture);
      this.#syncTexture(entry, 'normal', item.material.normalTexture);
      this.#syncTexture(entry, 'occlusion', item.material.occlusionTexture);
      this.#syncTexture(entry, 'emissive', item.material.emissiveTexture);
      mesh.position.set(...item.position);
      mesh.quaternion.set(...item.rotation);
      mesh.scale.set(...item.scale);
    }
  }

  #syncTexture(
    entry: {
      readonly mesh: THREE.Mesh;
      readonly materialLease: AssetResourceLease<THREE.MeshStandardMaterial>;
      textureSources: Map<TextureChannel, TextureSource>;
      textureLeases: Map<TextureChannel, AssetResourceLease<THREE.Texture>>;
      active: boolean;
    },
    channel: TextureChannel,
    source: TextureSource | undefined,
  ): void {
    const material = entry.materialLease.resource;
    const colorSpace =
      channel === 'baseColor' || channel === 'emissive' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const setTexture = (texture: THREE.Texture | null) => {
      switch (channel) {
        case 'baseColor':
          material.map = texture;
          break;
        case 'metallicRoughness':
          material.metalnessMap = texture;
          material.roughnessMap = texture;
          break;
        case 'normal':
          material.normalMap = texture;
          break;
        case 'occlusion':
          material.aoMap = texture;
          break;
        case 'emissive':
          material.emissiveMap = texture;
          break;
      }
      material.needsUpdate = true;
    };
    const previous = entry.textureSources.get(channel);
    if (!source) {
      if (previous) {
        entry.textureSources.delete(channel);
        entry.textureLeases.get(channel)?.release();
        entry.textureLeases.delete(channel);
        setTexture(null);
      }
      return;
    }
    if (previous?.assetId === source.assetId && previous.cacheKey === source.cacheKey) return;
    if (previous) {
      setTexture(null);
      entry.textureLeases.get(channel)?.release();
      entry.textureLeases.delete(channel);
    }
    entry.textureSources.set(channel, source);
    void this.#textureCache
      .acquire(
        `${source.cacheKey}:${colorSpace}`,
        async () => {
          const bitmap = await createImageBitmap(
            new Blob([source.data.slice().buffer as ArrayBuffer], { type: source.mimeType }),
          );
          const texture = new THREE.Texture(bitmap);
          texture.colorSpace = colorSpace;
          texture.flipY = false;
          texture.needsUpdate = true;
          return texture;
        },
        (texture) => {
          const bitmap = texture.image as ImageBitmap | undefined;
          texture.dispose();
          bitmap?.close();
        },
      )
      .then((lease) => {
        if (this.#disposed || !entry.active || entry.textureSources.get(channel) !== source) {
          lease.release();
          return;
        }
        entry.textureLeases.set(channel, lease);
        setTexture(lease.resource);
        const scene = this.#lastScene;
        if (scene && !this.#disposed) this.render(scene);
      })
      .catch((error: unknown) => {
        if (entry.textureSources.get(channel) === source) entry.textureSources.delete(channel);
        console.error(`Failed to decode ${channel} texture asset ${source.assetId}`, error);
      });
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
      this.#orthographicCamera.left = -width / 2;
      this.#orthographicCamera.right = width / 2;
      this.#orthographicCamera.top = height / 2;
      this.#orthographicCamera.bottom = -height / 2;
      this.#orthographicCamera.near = camera.near;
      this.#orthographicCamera.far = camera.far;
      this.#orthographicCamera.position.set(...camera.position);
      this.#orthographicCamera.quaternion.set(...camera.rotation);
      this.#orthographicCamera.updateProjectionMatrix();
      return this.#orthographicCamera;
    }
  }

  #keyFor(value: object, keys: WeakMap<object, string>, prefix: string): string {
    let key = keys.get(value);
    if (!key) {
      key = `${prefix}:${this.#nextResourceKey++}`;
      keys.set(value, key);
    }
    return key;
  }

  #releaseObject(entry: {
    readonly mesh: THREE.Mesh;
    readonly geometryLease: AssetResourceLease<THREE.BufferGeometry>;
    readonly materialLease: AssetResourceLease<THREE.MeshStandardMaterial>;
    textureSources: Map<TextureChannel, TextureSource>;
    textureLeases: Map<TextureChannel, AssetResourceLease<THREE.Texture>>;
    active: boolean;
  }): void {
    entry.active = false;
    this.#scene.remove(entry.mesh);
    for (const lease of entry.textureLeases.values()) lease.release();
    entry.textureLeases.clear();
    entry.textureSources.clear();
    entry.geometryLease.release();
    entry.materialLease.release();
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
