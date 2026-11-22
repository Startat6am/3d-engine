import * as THREE from 'three';
import { AssetResourceCache, type AssetResourceLease } from '@engine/assets';
import { validateMeshData, type MeshData } from '@engine/geometry';
import type {
  RendererAdapter,
  RendererCapabilities,
  RendererOptions,
  RenderScene,
  RenderObject,
  RendererPickHit,
  TextureSource,
  SkinningDescriptor,
} from './contracts.js';
import { RendererError, validateSkinningDescriptor } from './contracts.js';
import { applyMaterialState } from './material-state.js';
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
      mesh: THREE.Mesh;
      bones: THREE.Bone[];
      skeleton: THREE.Skeleton | null;
      geometrySource: object;
      skinSource: SkinningDescriptor | undefined;
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
  readonly #skinningKeys = new WeakMap<object, string>();
  readonly #validatedGeometry = new WeakSet<object>();
  readonly #materialKeys = new WeakMap<object, string>();
  #nextResourceKey = 1;
  readonly #raycaster = new THREE.Raycaster();
  readonly #orthographicCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 1000);
  #activeCamera: THREE.Camera | null = null;
  #disposed = false;
  readonly #handleContextRestored = (): void => {
    const scene = this.#lastScene;
    if (scene && !this.#disposed) this.render(scene);
  };
  #lastScene: RenderScene | null = null;
  #lastObjects: readonly RenderObject[] | null = null;
  #width = 0;
  #height = 0;

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
      // Three.js restores its GL state first; render the last scene afterwards so
      // textures and geometry are uploaded again without waiting for a UI change.
      this.#renderer.domElement.addEventListener(
        'webglcontextrestored',
        this.#handleContextRestored,
      );
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
    if (w === this.#width && h === this.#height) return;
    this.#width = w;
    this.#height = h;
    this.#renderer.setSize(w, h, false);
    this.#perspectiveCamera.aspect = w / h;
    this.#perspectiveCamera.updateProjectionMatrix();
  }

  render(scene: RenderScene): void {
    this.#assertActive();
    this.#lastScene = scene;
    if (scene.objects !== this.#lastObjects) {
      this.#syncObjects(scene.objects);
      this.#lastObjects = scene.objects;
    }
    this.#updateSkinning(scene.objects);
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
      [...this.#objects.values()]
        .filter((entry) => entry.mesh.userData['engineEntityId'] !== '__voxel-brush-preview__')
        .map((entry) => entry.mesh),
      false,
    );
    const entityId = intersections[0]?.object.userData['engineEntityId'];
    return typeof entityId === 'string' ? entityId : null;
  }

  pickSurface(x: number, y: number, width: number, height: number): RendererPickHit | null {
    this.#assertActive();
    const camera = this.#activeCamera;
    if (!camera || width <= 0 || height <= 0) return null;
    const pointer = new THREE.Vector2((x / width) * 2 - 1, 1 - (y / height) * 2);
    camera.updateMatrixWorld();
    this.#scene.updateMatrixWorld(true);
    this.#raycaster.setFromCamera(pointer, camera);
    const hit = this.#raycaster.intersectObjects(
      [...this.#objects.values()]
        .filter((entry) => entry.mesh.userData['engineEntityId'] !== '__voxel-brush-preview__')
        .map((entry) => entry.mesh),
      false,
    )[0];
    if (!hit) return null;
    const entityId = hit.object.userData['engineEntityId'];
    if (typeof entityId !== 'string' || !hit.face) return null;
    const normal = hit.face.normal
      .clone()
      .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .normalize();
    return {
      entityId,
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [normal.x, normal.y, normal.z],
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const entry of this.#objects.values()) this.#releaseObject(entry);
    this.#objects.clear();
    this.#lastScene = null;
    this.#lastObjects = null;
    this.#scene.clear();
    this.#renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.#handleContextRestored,
    );
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
      this.#validateGeometryOnce(item.geometry);
      if (item.skinning) validateSkinningDescriptor(item.geometry, item.skinning);
      let entry = this.#objects.get(item.id);
      const skinKey = item.skinning
        ? this.#keyFor(item.skinning, this.#skinningKeys, 'skinning')
        : 'static';
      const geometryKey = `${this.#keyFor(item.geometry, this.#geometryKeys, 'geometry')}:${skinKey}`;
      const materialKey = this.#keyFor(item.material, this.#materialKeys, 'material');
      let materialChanged = false;

      if (!entry) {
        const geometryLease = this.#geometryCache.acquireSync(
          geometryKey,
          () => this.#createGeometry(item.geometry, item.skinning),
          (geometry) => geometry.dispose(),
        );
        let materialLease: AssetResourceLease<THREE.MeshStandardMaterial> | undefined;
        try {
          materialLease = this.#materialCache.acquireSync(
            materialKey,
            () => new THREE.MeshStandardMaterial(),
            (material) => material.dispose(),
          );
          const created = this.#createMesh(
            item.id,
            geometryLease.resource,
            materialLease.resource,
            item.skinning,
          );
          entry = {
            mesh: created.mesh,
            bones: created.bones,
            skeleton: created.skeleton,
            active: true,
            textureSources: new Map(),
            textureLeases: new Map(),
            geometrySource: item.geometry,
            skinSource: item.skinning,
            materialSource: item.material,
            geometryLease,
            materialLease,
          };
          this.#objects.set(item.id, entry);
          this.#scene.add(entry.mesh);
        } catch (error) {
          materialLease?.release();
          geometryLease.release();
          throw error;
        }
        materialChanged = true;
      } else {
        const geometryChanged =
          entry.geometrySource !== item.geometry || entry.skinSource !== item.skinning;
        const materialChangedNow = entry.materialSource !== item.material;
        let nextGeometryLease: AssetResourceLease<THREE.BufferGeometry> | undefined;
        let nextMaterialLease: AssetResourceLease<THREE.MeshStandardMaterial> | undefined;
        let replacement:
          { mesh: THREE.Mesh; bones: THREE.Bone[]; skeleton: THREE.Skeleton | null } | undefined;
        try {
          if (geometryChanged) {
            nextGeometryLease = this.#geometryCache.acquireSync(
              geometryKey,
              () => this.#createGeometry(item.geometry, item.skinning),
              (geometry) => geometry.dispose(),
            );
          }
          if (materialChangedNow) {
            nextMaterialLease = this.#materialCache.acquireSync(
              materialKey,
              () => new THREE.MeshStandardMaterial(),
              (material) => material.dispose(),
            );
          }
          if (entry.skinSource !== item.skinning) {
            replacement = this.#createMesh(
              item.id,
              nextGeometryLease?.resource ?? entry.geometryLease.resource,
              nextMaterialLease?.resource ?? entry.materialLease.resource,
              item.skinning,
            );
          }
        } catch (error) {
          nextGeometryLease?.release();
          nextMaterialLease?.release();
          throw error;
        }
        if (replacement) {
          this.#scene.remove(entry.mesh);
          this.#disposeSkin(entry);
          entry.mesh = replacement.mesh;
          entry.bones = replacement.bones;
          entry.skeleton = replacement.skeleton;
          entry.skinSource = item.skinning;
          this.#scene.add(entry.mesh);
        } else if (nextGeometryLease) {
          entry.mesh.geometry = nextGeometryLease.resource;
        }
        if (nextGeometryLease) {
          const previousLease = entry.geometryLease;
          entry.geometryLease = nextGeometryLease;
          entry.geometrySource = item.geometry;
          previousLease.release();
        }
        if (nextMaterialLease) {
          const previousLease = entry.materialLease;
          for (const textureLease of entry.textureLeases.values()) textureLease.release();
          entry.textureLeases.clear();
          entry.textureSources.clear();
          entry.materialLease = nextMaterialLease;
          entry.materialSource = item.material;
          if (!replacement) entry.mesh.material = nextMaterialLease.resource;
          previousLease.release();
          materialChanged = true;
        }
      }

      const mesh = entry.mesh;
      if (materialChanged) {
        const material = entry.materialLease.resource;
        applyMaterialState(material, item.material);
        this.#syncTexture(entry, 'baseColor', item.material.baseColorTexture);
        this.#syncTexture(entry, 'metallicRoughness', item.material.metallicRoughnessTexture);
        this.#syncTexture(entry, 'normal', item.material.normalTexture);
        this.#syncTexture(entry, 'occlusion', item.material.occlusionTexture);
        this.#syncTexture(entry, 'emissive', item.material.emissiveTexture);
      }
      if (item.worldMatrix !== undefined) {
        if (item.worldMatrix.length !== 16) {
          throw new RendererError('INVALID_SCENE', 'Render object has an invalid world matrix');
        }
        for (let index = 0; index < 16; index += 1) {
          if (!Number.isFinite(item.worldMatrix[index])) {
            throw new RendererError('INVALID_SCENE', 'Render object has an invalid world matrix');
          }
        }
        mesh.matrix.fromArray(item.worldMatrix);
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldNeedsUpdate = true;
      } else {
        mesh.matrixAutoUpdate = true;
        mesh.position.set(...item.position);
        mesh.quaternion.set(...item.rotation);
        mesh.scale.set(...item.scale);
      }
    }
  }

  #createGeometry(geometryData: MeshData, skinning?: SkinningDescriptor): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geometryData.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(geometryData.normals, 3));
    if (geometryData.uvs) {
      const uv = new THREE.BufferAttribute(geometryData.uvs, 2);
      geometry.setAttribute('uv', uv);
      geometry.setAttribute('uv2', uv);
    }
    geometry.setIndex(new THREE.BufferAttribute(geometryData.indices, 1));
    if (skinning) {
      const normalizedWeights = skinning.jointWeights.slice();
      for (let vertex = 0; vertex < normalizedWeights.length; vertex += 4) {
        const total =
          normalizedWeights[vertex]! +
          normalizedWeights[vertex + 1]! +
          normalizedWeights[vertex + 2]! +
          normalizedWeights[vertex + 3]!;
        for (let influence = 0; influence < 4; influence++)
          normalizedWeights[vertex + influence] = normalizedWeights[vertex + influence]! / total;
      }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinning.jointIndices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(normalizedWeights, 4));
    }
    return geometry;
  }

  #createMesh(
    id: string,
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
    skinning?: SkinningDescriptor,
  ): { mesh: THREE.Mesh; bones: THREE.Bone[]; skeleton: THREE.Skeleton | null } {
    if (!skinning) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData['engineEntityId'] = id;
      return { mesh, bones: [], skeleton: null };
    }
    const bones: THREE.Bone[] = [];
    let skeleton: THREE.Skeleton | null = null;
    try {
      const jointCount = skinning.palette.length / 16;
      for (let joint = 0; joint < jointCount; joint++) {
        const bone = new THREE.Bone();
        bone.matrixAutoUpdate = false;
        bone.matrix.fromArray(skinning.palette, joint * 16);
        bone.matrixWorldNeedsUpdate = true;
        bones.push(bone);
        this.#scene.add(bone);
      }
      skeleton = new THREE.Skeleton(
        bones,
        bones.map(() => new THREE.Matrix4()),
      );
      const mesh = new THREE.SkinnedMesh(geometry, material);
      mesh.bind(skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.userData['engineEntityId'] = id;
      return { mesh, bones, skeleton };
    } catch (error) {
      for (const bone of bones) this.#scene.remove(bone);
      skeleton?.dispose();
      throw error;
    }
  }

  #updateSkinning(objects: readonly RenderObject[]): void {
    for (const item of objects) {
      if (!item.skinning) continue;
      const entry = this.#objects.get(item.id);
      if (
        !entry?.skeleton ||
        entry.skinSource !== item.skinning ||
        item.skinning.palette.length !== entry.bones.length * 16
      ) {
        throw new RendererError(
          'INVALID_SKIN',
          `Render object ${item.id} has no matching skinned mesh resources`,
        );
      }
      for (let joint = 0; joint < entry.bones.length; joint++) {
        entry.bones[joint]!.matrix.fromArray(item.skinning.palette, joint * 16);
        entry.bones[joint]!.matrixWorldNeedsUpdate = true;
      }
    }
  }

  #disposeSkin(entry: { bones: THREE.Bone[]; skeleton: THREE.Skeleton | null }): void {
    for (const bone of entry.bones) this.#scene.remove(bone);
    entry.skeleton?.dispose();
    entry.bones = [];
    entry.skeleton = null;
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
    const sampler = source?.sampler;
    const magFilter = sampler?.magFilter ?? 9729;
    const minFilter = sampler?.minFilter ?? 9987;
    const wrapS = sampler?.wrapS ?? 10497;
    const wrapT = sampler?.wrapT ?? 10497;
    const minFilterMap = new Map<number, THREE.MinificationTextureFilter>([
      [9728, THREE.NearestFilter],
      [9729, THREE.LinearFilter],
      [9984, THREE.NearestMipmapNearestFilter],
      [9985, THREE.LinearMipmapNearestFilter],
      [9986, THREE.NearestMipmapLinearFilter],
      [9987, THREE.LinearMipmapLinearFilter],
    ]);
    const wrapMap = new Map([
      [33071, THREE.ClampToEdgeWrapping],
      [33648, THREE.MirroredRepeatWrapping],
      [10497, THREE.RepeatWrapping],
    ]);
    const textureSettingsKey = JSON.stringify({
      sampler: { magFilter, minFilter, wrapS, wrapT },
      transform: source?.transform ?? null,
    });
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
    if (
      previous?.assetId === source.assetId &&
      previous.cacheKey === source.cacheKey &&
      JSON.stringify(previous.sampler) === JSON.stringify(source.sampler) &&
      JSON.stringify(previous.transform) === JSON.stringify(source.transform)
    ) {
      return;
    }
    if (previous) {
      setTexture(null);
      entry.textureLeases.get(channel)?.release();
      entry.textureLeases.delete(channel);
    }
    entry.textureSources.set(channel, source);
    void this.#textureCache
      .acquire(
        `${source.cacheKey}:${colorSpace}:${textureSettingsKey}`,
        async () => {
          const bitmap = await createImageBitmap(
            new Blob([source.data.slice().buffer as ArrayBuffer], { type: source.mimeType }),
          );
          const texture = new THREE.Texture(bitmap);
          texture.colorSpace = colorSpace;
          texture.flipY = false;
          texture.magFilter = magFilter === 9728 ? THREE.NearestFilter : THREE.LinearFilter;
          texture.minFilter = minFilterMap.get(minFilter) ?? THREE.LinearMipmapLinearFilter;
          texture.wrapS = wrapMap.get(wrapS) ?? THREE.RepeatWrapping;
          texture.wrapT = wrapMap.get(wrapT) ?? THREE.RepeatWrapping;
          texture.generateMipmaps = minFilter >= 9984;
          const transform = source.transform;
          if (transform) {
            texture.offset.set(...transform.offset);
            texture.repeat.set(...transform.scale);
            texture.rotation = transform.rotation;
            texture.center.set(0, 0);
            texture.updateMatrix();
          }
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
        // A removed/replaced object no longer owns this asynchronous decode. Avoid
        // reporting expected late failures after its texture lease was abandoned.
        if (this.#disposed || !entry.active || entry.textureSources.get(channel) !== source) {
          return;
        }
        entry.textureSources.delete(channel);
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

  #validateGeometryOnce(geometry: MeshData): void {
    if (this.#validatedGeometry.has(geometry)) return;
    validateMeshData(geometry);
    this.#validatedGeometry.add(geometry);
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
    bones: THREE.Bone[];
    skeleton: THREE.Skeleton | null;
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
    this.#disposeSkin(entry);
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
