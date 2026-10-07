import { Material, Texture, type Object3D, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assetManifestEntrySchema, type AssetManifestEntry } from './manifest';
import { ResourceCache } from './resource-cache';

export class AssetError extends Error {
  constructor(
    public readonly code: 'network' | 'missing-asset' | 'invalid-asset',
    message: string,
  ) {
    super(message);
    this.name = 'AssetError';
  }
}
export function disposeScene(scene: Object3D): void {
  const geometries = new Set<{ dispose(): void }>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  scene.traverse((object) => {
    if (
      'geometry' in object &&
      object.geometry &&
      typeof object.geometry === 'object' &&
      'dispose' in object.geometry
    )
      geometries.add(object.geometry as { dispose(): void });
    if ('material' in object) {
      const entries: unknown[] = Array.isArray(object.material)
        ? object.material
        : [object.material];
      entries.forEach((material) => {
        if (material instanceof Material) materials.add(material);
      });
    }
  });
  materials.forEach((material) =>
    Object.values(material).forEach((value) => {
      if (value instanceof Texture) textures.add(value);
    }),
  );
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}
/** Host decoder files locally; the procedural milestone never downloads a decoder. */
export function createGlbRuntime(
  renderer: WebGLRenderer,
  manifest: AssetManifestEntry[],
  decoderPath: string,
) {
  const ktx = new KTX2Loader().setTranscoderPath(`${decoderPath}/basis/`).detectSupport(renderer);
  const draco = new DRACOLoader().setDecoderPath(`${decoderPath}/draco/`);
  const loader = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(ktx)
    .setDRACOLoader(draco);
  const cache = new ResourceCache<Object3D>(async (id) => {
    const candidate = manifest.find((item) => item.id === id);
    if (!candidate)
      throw new AssetError('missing-asset', 'Asset is missing from the reviewed manifest.');
    const parsed = assetManifestEntrySchema.safeParse(candidate);
    if (!parsed.success) throw new AssetError('invalid-asset', 'Asset manifest failed validation.');
    const entry = parsed.data;
    if (entry.kind !== 'glb')
      throw new AssetError('invalid-asset', 'Expected a licensed GLB asset.');
    let response: Response;
    try {
      response = await fetch(entry.url);
    } catch {
      throw new AssetError('network', 'Asset request failed.');
    }
    if (!response.ok)
      throw new AssetError(
        response.status === 404 ? 'missing-asset' : 'network',
        'Asset request did not succeed.',
      );
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== entry.bytes)
      throw new AssetError('invalid-asset', 'Asset size does not match manifest.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== entry.sha256)
      throw new AssetError('invalid-asset', 'Asset integrity check failed.');
    try {
      return (await loader.parseAsync(buffer, new URL('.', entry.url).href)).scene;
    } catch {
      throw new AssetError('invalid-asset', 'The GLB could not be decoded.');
    }
  }, disposeScene);
  return {
    cache,
    disposeDecoders() {
      if (cache.activeResourceCount !== 0)
        throw new Error('Release all asset leases before disposing decoders');
      ktx.dispose();
      draco.dispose();
    },
  };
}
