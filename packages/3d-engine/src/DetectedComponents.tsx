import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
  Group,
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
import { assembledPosition } from './motion/layout';
import { visualId, type MotionRequest, type VisualDefinition } from './motion/types';
import type { MotionController } from './motion/controller';
import type { MotionBindings } from './motion/bindings';
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
  motion?: MotionRequest;
}
type Materials = Record<Finish, MeshStandardMaterial>;
const createMaterials = () =>
  Object.fromEntries(
    Object.entries(finishes).map(([key, [color, roughness, metalness]]) => [
      key,
      new MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.65 }),
    ]),
  ) as Materials;
function useMotionVisual(
  definition: VisualDefinition,
  engine: MotionController,
  bindings: MotionBindings,
) {
  const ref = useRef<Group>(null);
  const { invalidate } = useThree();
  useLayoutEffect(() => {
    engine.define(definition, performance.now());
    if (ref.current) bindings.attach(definition.id, ref.current);
    bindings.apply(engine);
    invalidate();
    return () => bindings.detach(definition.id);
  }, [definition, engine, bindings, invalidate]);
  return ref;
}
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
  engine,
  bindings,
  detail,
  position,
  ordinal,
  sceneBounds,
}: {
  device: DetectedVisual;
  scene: DetectedScene;
  engine: MotionController;
  bindings: MotionBindings;
  detail: number;
  position: Vector3Tuple;
  ordinal: number;
  sceneBounds: VisualDefinition['sceneBounds'];
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
  const id = visualId(category, device.index, name);
  const materials = useMemo(createMaterials, []);
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);
  const definition = useMemo<VisualDefinition>(
    () => ({
      id,
      category,
      index: device.index,
      ordinal,
      placement,
      assembled: { position, rotation: [0, 0, 0] },
      bounds: { min: model.bounds.min.toArray(), max: model.bounds.max.toArray() },
      sceneBounds,
    }),
    [id, category, device.index, ordinal, placement, position, model, sceneBounds],
  );
  const ref = useMotionVisual(definition, engine, bindings);
  const selected =
    scene.selected?.category === device.category && scene.selected.index === device.index;
  return (
    <group
      ref={ref}
      userData={{
        detectedCategory: device.category,
        detectedIndex: device.index,
        motionId: id,
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
  engine,
  bindings,
}: {
  scene: DetectedScene;
  level: QualityLevel;
  lod: number;
  engine: MotionController;
  bindings: MotionBindings;
}) {
  const detail = level === 'low' || lod === 2 ? 0 : level === 'medium' || lod === 1 ? 1 : 2;
  const layout = boardFamilies[scene.boardFamily];
  const materials = useMemo(createMaterials, []);
  useEffect(
    () => () => {
      Object.values(materials).forEach((m) => m.dispose());
    },
    [materials],
  );
  const model = useMemo(() => boardModel(scene.boardFamily, detail), [scene.boardFamily, detail]);
  const storage = scene.devices.filter((v) => v.category === 'storage' && v.placement !== 'm2');
  const sceneBounds = useMemo(
    () => ({ min: model.bounds.min.toArray(), max: model.bounds.max.toArray() }),
    [model],
  );
  const boardId = visualId('motherboard', 0, scene.boardName);
  const boardDefinition = useMemo<VisualDefinition>(
    () => ({
      id: boardId,
      category: 'motherboard',
      index: 0,
      ordinal: 0,
      assembled: { position: [0, 0, 0], rotation: [0, 0, 0] },
      bounds: sceneBounds,
      sceneBounds,
    }),
    [boardId, sceneBounds],
  );
  const ref = useMotionVisual(boardDefinition, engine, bindings);
  useLayoutEffect(() => {
    engine.prune(
      new Set([boardId, ...scene.devices.map((d) => visualId(d.category, d.index, d.name))]),
    );
  }, [engine, boardId, scene.devices]);
  return (
    <group scale={0.001}>
      <group
        ref={ref}
        userData={{
          detectedCategory: 'motherboard',
          motionId: boardId,
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
        const position = assembledPosition(device, scene.boardFamily, scene.devices);
        const ordinal = scene.devices
          .filter((d) => d.category === device.category)
          .findIndex((d) => d.index === device.index);
        return (
          <Device
            key={visualId(device.category, device.index, device.name)}
            device={device}
            scene={scene}
            engine={engine}
            bindings={bindings}
            detail={detail}
            position={position}
            ordinal={ordinal}
            sceneBounds={sceneBounds}
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
