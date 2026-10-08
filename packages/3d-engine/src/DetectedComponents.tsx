import { useEffect, useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import {
  Box3,
  BoxGeometry,
  EdgesGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { boardFamilies, resolveDetectedVisual, type BoardFamily } from '@cortex/asset-runtime';
import {
  boardModel,
  deviceModel,
  finishes,
  type Finish,
  type Instances,
  type Model,
} from './detected-models';
import type { QualityLevel } from './quality';
import type { Vector3Tuple } from './semantics';
import { cpuIdentity } from './cpu-identity';
import { createCpuMarking } from './cpu-marking';
export interface DetectedVisual {
  category: 'cpu' | 'gpu' | 'memory' | 'storage';
  index: number;
  name: string;
  manufacturer?: string;
  placement?: 'm2' | 'inventory';
}
export interface DetectedScene {
  devices: DetectedVisual[];
  boardFamily: BoardFamily;
  boardName: string;
  selected?: { category: string; index?: number };
  onSelect(category: DetectedVisual['category'] | 'motherboard', index?: number): void;
}
type Materials = Record<Finish, MeshStandardMaterial>;
function Repeat({ batch, material }: { batch: Instances; material: MeshStandardMaterial }) {
  const ref = useRef<InstancedMesh>(null),
    { invalidate } = useThree();
  const flat = batch.flat,
    width = batch.size[0],
    depth = batch.size[2];
  const flatGeometry = useMemo(
    () => (flat ? new PlaneGeometry(width, depth).rotateX(-Math.PI / 2) : null),
    [flat, width, depth],
  );
  useEffect(() => () => flatGeometry?.dispose(), [flatGeometry]);
  useEffect(() => {
    const matrix = new Matrix4();
    batch.positions.forEach((p, i) => {
      matrix.makeTranslation(...p);
      ref.current?.setMatrixAt(i, matrix);
    });
    if (ref.current) {
      ref.current.instanceMatrix.needsUpdate = true;
      ref.current.computeBoundingSphere();
    }
    invalidate();
  }, [batch, invalidate]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, material, batch.positions.length]}
      castShadow
      receiveShadow
    >
      {batch.flat ? (
        <primitive object={flatGeometry!} attach="geometry" />
      ) : batch.cylinder ? (
        <cylinderGeometry args={[batch.size[0] / 2, batch.size[0] / 2, batch.size[1], 12]} />
      ) : (
        <boxGeometry args={batch.size} />
      )}
    </instancedMesh>
  );
}
function ModelMeshes({ model, materials }: { model: Model; materials: Materials }) {
  useEffect(
    () => () => {
      for (const m of model.meshes) m.geometry.dispose();
    },
    [model],
  );
  return (
    <>
      {model.meshes.map((m) => (
        <mesh
          key={m.finish}
          geometry={m.geometry}
          material={materials[m.finish]}
          castShadow
          receiveShadow
        />
      ))}
      {model.instances.map((batch, i) => (
        <Repeat key={i} batch={batch} material={materials[batch.finish]} />
      ))}
    </>
  );
}
function Selection({ bounds }: { bounds: Box3 }) {
  const size = bounds.getSize(new Vector3()).addScalar(2),
    center = bounds.getCenter(new Vector3());
  const geometry = useMemo(() => {
    const box = new BoxGeometry(size.x, size.y, size.z),
      edges = new EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [size.x, size.y, size.z]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments position={center} geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color="#b9ceab" transparent opacity={0.45} depthWrite={false} />
    </lineSegments>
  );
}
function Device({
  device,
  scene,
  materials,
  detail,
  position,
}: {
  device: DetectedVisual;
  scene: DetectedScene;
  materials: Materials;
  detail: number;
  position: Vector3Tuple;
}) {
  const { category, placement, name, manufacturer } = device;
  const model = useMemo(
    () => deviceModel({ category, placement, name, manufacturer }, detail),
    [category, placement, name, manufacturer, detail],
  );
  const marking = useMemo(
    () => (category === 'cpu' ? createCpuMarking(name, manufacturer) : null),
    [category, name, manufacturer],
  );
  useEffect(() => () => marking?.dispose(), [marking]);
  const identity = category === 'cpu' ? cpuIdentity(name, manufacturer) : null;
  const selected =
    scene.selected?.category === device.category && scene.selected.index === device.index;
  return (
    <group
      position={position}
      userData={{
        detectedCategory: device.category,
        detectedIndex: device.index,
        assetId: resolveDetectedVisual(device.category).assetId,
        ...(identity
          ? {
              cpuFamily: identity.family,
              cpuLabel: marking?.userData.cpuLabel,
              cpuTemplate: identity.template,
            }
          : {}),
      }}
      onClick={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (event.delta <= 5) scene.onSelect(device.category, device.index);
      }}
    >
      <ModelMeshes model={model} materials={materials} />
      {marking && (
        <mesh position={[0, 3.43, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <planeGeometry args={[26, 26]} />
          <meshStandardMaterial
            map={marking}
            transparent
            roughness={0.72}
            metalness={0.15}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      )}
      {selected && <Selection bounds={model.bounds} />}
    </group>
  );
}
export default function DetectedComponents({
  scene,
  level,
  lod,
}: {
  scene: DetectedScene;
  level: QualityLevel;
  lod: number;
}) {
  const detail = level === 'low' || lod === 2 ? 0 : level === 'medium' || lod === 1 ? 1 : 2;
  const layout = boardFamilies[scene.boardFamily];
  const materials = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(finishes).map(([key, [color, roughness, metalness]]) => [
          key,
          new MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.65 }),
        ]),
      ) as Materials,
    [],
  );
  useEffect(
    () => () => {
      Object.values(materials).forEach((m) => m.dispose());
    },
    [materials],
  );
  const model = useMemo(() => boardModel(scene.boardFamily, detail), [scene.boardFamily, detail]);
  const storage = scene.devices.filter((v) => v.category === 'storage' && v.placement !== 'm2');
  const storageOrder = new Map(storage.map((v, i) => [v.index, i]));
  const cpuZ = -layout.depth / 2 + 82;
  return (
    <group scale={0.001}>
      <group
        userData={{
          detectedCategory: 'motherboard',
          assetId: resolveDetectedVisual('motherboard', undefined, scene.boardFamily).assetId,
        }}
        onClick={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          if (event.delta <= 5) scene.onSelect('motherboard');
        }}
      >
        <ModelMeshes model={model} materials={materials} />
        {scene.selected?.category === 'motherboard' && <Selection bounds={model.bounds} />}
      </group>
      {scene.devices.map((device) => {
        const i = device.index,
          gpuOrder = scene.devices
            .filter((d) => d.category === 'gpu')
            .findIndex((d) => d.index === i),
          trayIndex = storageOrder.get(i) ?? 0;
        const position: Vector3Tuple =
          device.category === 'cpu'
            ? [-20 + i * 55, 7, cpuZ]
            : device.category === 'memory'
              ? i < layout.sockets
                ? [48 + i * 13, 25, cpuZ]
                : [layout.width / 2 + 50 + (i - layout.sockets) * 12, 27, -layout.depth / 2 + 70]
              : device.category === 'gpu'
                ? [-22, 0, layout.depth / 2 - (layout.depth > 200 ? 104 : 27) + gpuOrder * 42]
                : device.placement === 'm2'
                  ? [-17, 5, layout.depth / 2 - (layout.depth > 200 ? 104 : 27) - 20]
                  : [
                      layout.width / 2 + 56 + (trayIndex % 2) * 68,
                      0,
                      -35 + Math.floor(trayIndex / 2) * 56,
                    ];
        return (
          <Device
            key={`${device.category}-${i}`}
            device={device}
            scene={scene}
            materials={materials}
            detail={detail}
            position={position}
          />
        );
      })}
      {storage.length > 0 && (
        <group
          position={[layout.width / 2 + 90, -2, -9 + Math.floor((storage.length - 1) / 2) * 28]}
        >
          <mesh material={materials.tray} receiveShadow>
            <boxGeometry args={[138, 2, Math.ceil(storage.length / 2) * 56 + 7]} />
          </mesh>
        </group>
      )}
    </group>
  );
}
