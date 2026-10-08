import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Html, OrbitControls } from '@react-three/drei';
import StudioContact from './StudioContact';
import {
  ACESFilmicToneMapping,
  Box3,
  Group,
  InstancedMesh,
  Matrix4,
  PerspectiveCamera,
  PMREMGenerator,
  PCFShadowMap,
  Vector3,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Motherboard } from '@cortex/part-schema';
import { resolveVisualTemplate } from '@cortex/asset-runtime';
import InstalledComponents, { type AssemblyScene } from './InstalledComponents';
import DetectedComponents, { type DetectedScene } from './DetectedComponents';
import { MotionController, frameBounds } from './motion/controller';
import { MotionBindings } from './motion/bindings';
import { visualId } from './motion/types';
import {
  motherboardComponents,
  type CameraAction,
  type ComponentDescriptor,
  type ComponentId,
  type Vector3Tuple,
} from './semantics';
import {
  AdaptiveQualityManager,
  chooseLod,
  qualityProfiles,
  type QualityLevel,
  type QualityMode,
} from './quality';

const sceneColors = {
  accent: '#baf36c',
  background: '#101617',
  grid: '#263130',
  gold: '#bb9b54',
  capacitor: '#75878b',
};
export interface SceneMetrics {
  motion: MotionController['diagnostics'];
  materials: number;
  geometryBytes: number;
  estimatedGpuBytes: number;
  viewport: { width: number; height: number; samples: number };
  pbrPalette: string[];
  hardwareVisuals: {
    category: string;
    index?: number;
    assetId: string;
    projection: number[];
    cpuFamily?: string;
    cpuLabel?: string;
    cpuTemplate?: string;
    storageFamily?: string;
    storageLabel?: string;
    storagePlacement?: string;
  }[];
  installedVisuals: {
    slotId: string;
    partId: string;
    phase: string;
    position: number[];
    rotation: number[];
  }[];
  fps: number;
  frameMs: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  quality: QualityLevel;
  camera: string;
  cpuRenderMs: number;
  projections: Record<string, [number, number]>;
}
export interface ExplorerRendererProps {
  detected?: DetectedScene;
  assembly?: AssemblyScene;
  board?: Motherboard;
  selected: ComponentId | null;
  hovered: ComponentId | null;
  onSelect(id: ComponentId): void;
  onHover(id: ComponentId | null): void;
  exploded: boolean;
  labels: boolean;
  reducedMotion: boolean;
  quality: QualityMode;
  cameraCommand: { action: CameraAction; revision: number };
  diagnostics: boolean;
  onMetrics(metrics: SceneMetrics): void;
  onFailure(): void;
}
interface Decoration {
  position: Vector3Tuple;
  scale: Vector3Tuple;
}
function RepeatedBoxes({ items, color }: { items: Decoration[]; color: string }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const matrix = new Matrix4();
    items.forEach((item, i) => {
      matrix.makeScale(...item.scale);
      matrix.setPosition(...item.position);
      ref.current?.setMatrixAt(i, matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.65} />
    </instancedMesh>
  );
}
function Region({
  descriptor: d,
  props,
}: {
  descriptor: ComponentDescriptor;
  props: ExplorerRendererProps;
}) {
  const group = useRef<Group>(null);
  const { invalidate } = useThree();
  const selected = props.selected === d.id;
  const valid = props.assembly?.validSlots.some((id) => id === d.id);
  const active = selected || props.hovered === d.id;
  const highlight = valid
    ? props.assembly?.preview?.slotId === d.id
      ? '#94cabb'
      : '#5f9585'
    : sceneColors.accent;
  const y = (d.position[1] + (props.exploded ? d.explode : 0)) / 1000;
  useLayoutEffect(() => {
    if (group.current && props.reducedMotion) group.current.position.y = y;
    invalidate();
  }, [y, props.reducedMotion, invalidate]);
  useFrame((_, delta) => {
    if (!group.current) return;
    const difference = y - group.current.position.y;
    if (Math.abs(difference) > 0.00005) {
      group.current.position.y += difference * (1 - Math.exp(-Math.min(delta, 0.05) * 12));
      invalidate();
    } else group.current.position.y = y;
  });
  const size = useMemo(() => d.size.map((value) => value / 1000) as Vector3Tuple, [d.size]);
  const color =
    d.kind === 'board'
      ? props.board!.visual.materials.pcb
      : ['heatsink', 'io', 'm2'].includes(d.kind)
        ? props.board!.visual.materials.metal
        : props.board!.visual.materials.plastic;
  const fins = useMemo<Decoration[]>(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        position: [((i - 4) * size[0]) / 10, size[1] / 2 + 0.003, 0],
        scale: [0.001, 0.006, size[2] * 0.87],
      })),
    [size],
  );
  const stop = (event: ThreeEvent<PointerEvent>) => event.stopPropagation();
  return (
    <group
      ref={group}
      position={[d.position[0] / 1000, d.position[1] / 1000, d.position[2] / 1000]}
      userData={{ semanticId: d.id }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.delta > 5) return;
        props.onSelect(d.id);
      }}
      onPointerOver={(event) => {
        stop(event);
        if (event.pointerType !== 'touch') props.onHover(d.id);
      }}
      onPointerOut={(event) => {
        stop(event);
        props.onHover(null);
      }}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={valid || active ? highlight : color}
          emissive={valid || active ? highlight : '#000000'}
          emissiveIntensity={valid || active ? 0.13 : 0}
          roughness={d.kind === 'board' ? 0.85 : 0.5}
          metalness={['heatsink', 'io'].includes(d.kind) ? 0.7 : 0.18}
        />
      </mesh>
      {d.kind === 'socket' && (
        <>
          <mesh position={[0, 0.006, 0]}>
            <boxGeometry args={[0.043, 0.002, 0.043]} />
            <meshStandardMaterial
              color={active ? sceneColors.accent : '#717c7a'}
              metalness={0.75}
              roughness={0.42}
            />
          </mesh>
          <mesh position={[0, 0.0075, 0]}>
            <boxGeometry args={[0.032, 0.001, 0.032]} />
            <meshStandardMaterial color={sceneColors.gold} metalness={0.85} roughness={0.7} />
          </mesh>
          <mesh position={[0.026, 0.009, 0]}>
            <boxGeometry args={[0.002, 0.002, 0.05]} />
            <meshStandardMaterial
              color={props.board!.visual.materials.metal}
              metalness={0.8}
              roughness={0.3}
            />
          </mesh>
        </>
      )}
      {(d.kind === 'dimm' || d.kind === 'pcie') && (
        <>
          <mesh position={[0, size[1] / 2 + 0.0005, 0]}>
            <boxGeometry
              args={
                d.kind === 'dimm' ? [0.002, 0.001, size[2] * 0.87] : [size[0] * 0.89, 0.001, 0.002]
              }
            />
            <meshStandardMaterial color={sceneColors.gold} />
          </mesh>
          {[-1, 1].map((sign) => (
            <mesh
              key={sign}
              position={
                d.kind === 'dimm'
                  ? [0, 0.005, (sign * size[2]) / 2]
                  : [(sign * size[0]) / 2, 0.004, 0]
              }
            >
              <boxGeometry args={[0.01, 0.008, 0.01]} />
              <meshStandardMaterial color={active ? sceneColors.accent : '#89938b'} />
            </mesh>
          ))}
        </>
      )}
      {d.kind === 'heatsink' && (
        <RepeatedBoxes items={fins} color={active ? sceneColors.accent : '#4b595d'} />
      )}
      {d.kind === 'm2' && !props.assembly?.installations.some((i) => i.slotId === d.id) && (
        <mesh position={[0, 0.003, 0]}>
          <boxGeometry args={[size[0] * 0.9, 0.001, size[2] * 0.66]} />
          <meshStandardMaterial
            color={active ? sceneColors.accent : '#4b595d'}
            metalness={0.75}
            roughness={0.5}
          />
        </mesh>
      )}
      {props.labels &&
        [
          'motherboard.cpuSocket',
          'motherboard.dimm.b2',
          'motherboard.pcie.x16_1',
          'motherboard.m2.slot1',
          'motherboard.chipset',
        ].includes(d.id) && (
          <Html position={[0, size[1] / 2 + 0.008, 0]} center style={{ pointerEvents: 'none' }}>
            <span className={`scene-label ${selected ? 'is-selected' : ''}`}>{d.label}</span>
          </Html>
        )}
    </group>
  );
}
function Decorations({ lod }: { lod: number }) {
  const chips = useMemo<Decoration[]>(
    () =>
      Array.from({ length: lod === 2 ? 12 : 38 }, (_, i) => ({
        position: [(-84 + (i % 7) * 23) / 1000, 0.003, (46 + Math.floor(i / 7) * 17) / 1000],
        scale: [0.006, 0.003, 0.006],
      })),
    [lod],
  );
  const capacitors = useMemo<Decoration[]>(
    () =>
      Array.from({ length: lod === 2 ? 8 : 24 }, (_, i) => ({
        position: [(-52 + (i % 8) * 9) / 1000, 0.007, (-124 + Math.floor(i / 8) * 15) / 1000],
        scale: [0.005, 0.011, 0.005],
      })),
    [lod],
  );
  const screws = useMemo<Decoration[]>(
    () =>
      [-112, 105].flatMap((x) =>
        [-139, 0, 141].map((z) => ({
          position: [x / 1000, 0.002, z / 1000] as Vector3Tuple,
          scale: [0.006, 0.002, 0.006] as Vector3Tuple,
        })),
      ),
    [],
  );
  return (
    <>
      <RepeatedBoxes items={chips} color="#14211f" />
      <RepeatedBoxes items={capacitors} color={sceneColors.capacitor} />
      <RepeatedBoxes items={screws} color={sceneColors.gold} />
    </>
  );
}
interface CameraPose {
  position: Vector3Tuple;
  target: Vector3Tuple;
  revision: number;
}
function StudioEnvironment() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const room = new RoomEnvironment(),
      generator = new PMREMGenerator(gl);
    const target = generator.fromScene(room, 0.04);
    scene.environment = target.texture;
    room.dispose();
    generator.dispose();
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}
function Scene({
  props,
  level,
  onLevel,
  manager,
  pose,
  motion,
  bindings,
}: {
  props: ExplorerRendererProps;
  level: QualityLevel;
  onLevel(level: QualityLevel): void;
  manager: AdaptiveQualityManager;
  pose: { current: CameraPose | null };
  motion: MotionController;
  bindings: MotionBindings;
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const hardwareRoot = useRef<Group>(null);
  const { camera, gl, invalidate, scene } = useThree();
  const [lod, setLod] = useState(1);
  const lastFrame = useRef(0);
  const appliedRevision = useRef<number | null>(null);
  const { size } = useThree();
  useLayoutEffect(() => {
    const request = props.detected?.motion;
    if (request) {
      motion.configure(request, props.reducedMotion, performance.now());
      bindings.apply(motion);
      invalidate();
    }
  }, [motion, bindings, props.detected?.motion, props.reducedMotion, invalidate]);
  const profile = qualityProfiles[level];
  const onFailure = props.onFailure;
  useEffect(() => {
    const canvas = gl.domElement;
    const handleLoss = (event: Event) => {
      event.preventDefault();
      onFailure();
    };
    canvas.addEventListener('webglcontextlost', handleLoss);
    return () => canvas.removeEventListener('webglcontextlost', handleLoss);
  }, [gl, onFailure]);
  useEffect(() => {
    // Antialias changes replace the WebGL context. Retain the user's camera
    // unless a new explicit camera command was issued during the replacement.
    if (
      pose.current?.revision === props.cameraCommand.revision &&
      appliedRevision.current === null
    ) {
      camera.position.fromArray(pose.current.position);
      controls.current?.target.fromArray(pose.current.target);
      if (controls.current)
        controls.current.maxDistance = Math.max(
          1.4,
          camera.position.distanceTo(controls.current.target) * 1.5,
        );
      (camera as PerspectiveCamera).far = Math.max(
        10,
        camera.position.distanceTo(new Vector3(...pose.current.target)) * 3,
      );
      camera.updateProjectionMatrix();
      controls.current?.update();
      appliedRevision.current = props.cameraCommand.revision;
      invalidate();
      if (!motion.cameraActive) return;
    }
    const selected = motherboardComponents.find((item) => item.id === props.selected);
    // Explicit camera commands cancel residual orbit momentum before fitting.
    // Otherwise damping can keep nudging a newly fitted pose on slow GPUs.
    if (controls.current) {
      const damping = controls.current.enableDamping;
      controls.current.enableDamping = false;
      controls.current.update();
      controls.current.enableDamping = damping;
    }
    let target = new Vector3(0, 0.012, 0);
    let position = new Vector3(0.32, 0.4, 0.36);
    if (props.cameraCommand.action === 'zoom-in' || props.cameraCommand.action === 'zoom-out') {
      target = controls.current?.target.clone() ?? target;
      const offset = camera.position.clone().sub(target);
      const factor = props.cameraCommand.action === 'zoom-in' ? 0.8 : 1.25;
      offset.setLength(Math.max(0.12, Math.min(1.4, offset.length() * factor)));
      position = target.clone().add(offset);
    } else if (props.cameraCommand.action === 'focus' && selected) {
      target = new Vector3(
        selected.position[0] / 1000,
        (selected.position[1] + (props.exploded ? selected.explode : 0)) / 1000,
        selected.position[2] / 1000,
      );
      position = target.clone().add(new Vector3(0.13, 0.19, 0.15));
    } else if (
      props.cameraCommand.action === 'fit' ||
      (props.detected && props.cameraCommand.action === 'reset')
    ) {
      const extent =
        Math.max(
          props.board?.visual.dimensions.width ?? 244,
          props.board?.visual.dimensions.depth ?? 280,
        ) / 1000;
      const portraitFactor = gl.domElement.clientHeight / Math.max(gl.domElement.clientWidth, 1);
      position = new Vector3(extent * Math.max(1, portraitFactor), extent * 1.35, extent * 1.2);
    }
    if (props.detected) {
      const from = {
        position: camera.position.toArray() as Vector3Tuple,
        target: (controls.current?.target.toArray() ?? [0, 0.012, 0]) as Vector3Tuple,
      };
      const selected = props.detected.selected;
      const device =
        selected?.category === 'motherboard'
          ? { name: props.detected.boardName, index: 0 }
          : props.detected.devices.find(
              (d) => d.category === selected?.category && d.index === selected?.index,
            );
      const id =
        device && selected ? visualId(selected.category, device.index, device.name) : undefined;
      const focusBounds = props.cameraCommand.action === 'focus' && id ? motion.bounds(id) : [];
      if (props.cameraCommand.action !== 'zoom-in' && props.cameraCommand.action !== 'zoom-out') {
        if (props.cameraCommand.action === 'focus' && !focusBounds.length) return;
        const framed = frameBounds(
          focusBounds.length ? focusBounds : motion.bounds(),
          from,
          (camera as PerspectiveCamera).fov,
          size.width / Math.max(1, size.height),
          props.cameraCommand.action === 'reset' || props.cameraCommand.revision === 0,
        );
        position.fromArray(framed.position);
        target.fromArray(framed.target);
      }
    }
    appliedRevision.current = props.cameraCommand.revision;
    if (controls.current)
      controls.current.maxDistance = Math.max(1.4, position.distanceTo(target) * 1.5);
    (camera as PerspectiveCamera).far = Math.max(10, position.distanceTo(target) * 3);
    camera.updateProjectionMatrix();
    motion.startCamera(
      {
        position: camera.position.toArray() as Vector3Tuple,
        target: (controls.current?.target.toArray() ?? [0, 0.012, 0]) as Vector3Tuple,
      },
      { position: position.toArray() as Vector3Tuple, target: target.toArray() as Vector3Tuple },
      performance.now(),
      props.reducedMotion,
      props.detected?.motion?.entrance && props.cameraCommand.revision === 0 ? 800 : 620,
    );
    bindings.apply(motion);
    invalidate();
    // Commands and viewport changes retarget the sole camera track from its actual pose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.cameraCommand.revision,
    props.reducedMotion,
    camera,
    gl,
    invalidate,
    size.width,
    size.height,
  ]);
  useFrame((state) => {
    const now = performance.now();
    const gap = now - lastFrame.current;
    lastFrame.current = now;
    const wasActive = motion.activeHandles > 0;
    const active = motion.tick(now);
    bindings.apply(motion);
    const cameraPose = motion.consumeCamera();
    if (cameraPose && controls.current) {
      camera.position.fromArray(cameraPose.position);
      controls.current.target.fromArray(cameraPose.target);
      controls.current.enableDamping = false;
      controls.current.update();
      controls.current.enableDamping = true;
    }
    // One final frame lets finite contact baking observe the completed transforms.
    if (active || wasActive) invalidate();
    if (props.quality === 'auto') {
      const next = manager.sample(gap, now, state.internal.frames > 1);
      if (next !== level) onLevel(next);
    }
    const nextLod = chooseLod(
      camera.position.distanceTo(new Vector3()),
      props.board?.visual.lod.map((item) => item.distance) ?? [0, 0.65, 1.2],
      profile.lodBias,
    );
    if (nextLod !== lod) setLod(nextLod);
    if (controls.current && appliedRevision.current !== null)
      pose.current = {
        position: camera.position.toArray() as Vector3Tuple,
        target: controls.current.target.toArray() as Vector3Tuple,
        revision: appliedRevision.current,
      };
    const signature = camera.position
      .toArray()
      .map((v) => v.toFixed(3))
      .join(',');
    // Capture completed-frame statistics, after replacement buffers upload.
    const renderStart = performance.now();
    gl.render(scene, camera);
    const cpuRenderMs = performance.now() - renderStart;
    if (props.diagnostics) {
      const materials = new Set<string>();
      const pbrPalette = new Set<string>();
      const geometries = new Set<string>();
      let geometryBytes = 0;
      const hardwareVisuals: SceneMetrics['hardwareVisuals'] = [];
      const installedVisuals: SceneMetrics['installedVisuals'] = [];
      scene.traverse((object) => {
        if ('material' in object) {
          const value = object.material as { uuid: string } | { uuid: string }[];
          for (const material of Array.isArray(value) ? value : [value])
            materials.add(material.uuid);
          for (const material of Array.isArray(value) ? value : [value]) {
            const pbr = material as import('three').MeshStandardMaterial;
            if (pbr.isMeshStandardMaterial)
              pbrPalette.add(`${pbr.color.getHexString()}:${pbr.roughness}:${pbr.metalness}`);
          }
        }
        if ('geometry' in object) {
          const geometry = object.geometry as import('three').BufferGeometry;
          if (!geometries.has(geometry.uuid)) {
            geometries.add(geometry.uuid);
            for (const attribute of Object.values(geometry.attributes))
              geometryBytes += attribute.array.byteLength;
            geometryBytes += geometry.index?.array.byteLength ?? 0;
          }
        }
        if (object instanceof InstancedMesh)
          geometryBytes += object.instanceMatrix.array.byteLength;
        if (object.userData.detectedCategory) {
          const bounds = new Box3().setFromObject(object),
            center = bounds.getCenter(new Vector3()).project(camera);
          hardwareVisuals.push({
            category: object.userData.detectedCategory,
            index: object.userData.detectedIndex,
            assetId: object.userData.assetId,
            ...(object.userData.cpuFamily
              ? {
                  cpuFamily: object.userData.cpuFamily,
                  cpuLabel: object.userData.cpuLabel,
                  cpuTemplate: object.userData.cpuTemplate,
                }
              : {}),
            ...(object.userData.storageFamily
              ? {
                  storageFamily: object.userData.storageFamily,
                  storageLabel: object.userData.storageLabel,
                  storagePlacement: object.userData.storagePlacement,
                }
              : {}),
            projection: [(center.x + 1) / 2, (1 - center.y) / 2],
          });
        }
        if (object.userData.partId)
          installedVisuals.push({
            slotId: object.userData.semanticId,
            partId: object.userData.partId,
            phase: object.userData.phase,
            position: object.position.toArray(),
            rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
          });
      });
      const context = gl.getContext(),
        pixels = gl.domElement.width * gl.domElement.height;
      const samples = Number(context.getParameter(context.SAMPLES)) || 1;
      const environment = scene.environment?.image as
        { width?: number; height?: number } | undefined;
      // Planning estimate, not driver telemetry: buffers + RGBA16F environment,
      // color/depth shadow targets, two contact targets and color/depth MSAA framebuffer.
      const estimatedGpuBytes =
        geometryBytes +
        (environment?.width ?? 0) * (environment?.height ?? 0) * 8 +
        profile.shadowMap ** 2 * 8 +
        (profile.effects ? 512 ** 2 * 16 : 0) +
        pixels * 8 * (samples + 1);
      props.onMetrics({
        motion: motion.diagnostics,
        cpuRenderMs,
        materials: materials.size,
        geometryBytes,
        estimatedGpuBytes,
        viewport: { width: gl.domElement.width, height: gl.domElement.height, samples },
        pbrPalette: [...pbrPalette].sort(),
        hardwareVisuals,
        installedVisuals,
        fps: gap > 0 && gap < 100 ? Math.round(1000 / gap) : 0,
        frameMs: gap < 100 ? Math.round(gap * 10) / 10 : 0,
        calls: state.gl.info.render.calls,
        triangles: state.gl.info.render.triangles,
        geometries: state.gl.info.memory.geometries,
        textures: state.gl.info.memory.textures,
        quality: level,
        camera: signature,
        projections: Object.fromEntries(
          motherboardComponents.map((c) => {
            const point = new Vector3(
              c.position[0] / 1000,
              (c.position[1] + (props.exploded ? c.explode : 0)) / 1000,
              c.position[2] / 1000,
            ).project(camera);
            return [c.id, [(point.x + 1) / 2, (1 - point.y) / 2] as [number, number]];
          }),
        ),
      });
    }
  }, 1);
  return (
    <>
      <color attach="background" args={[sceneColors.background]} />
      {props.detected && <StudioEnvironment />}
      <ambientLight intensity={props.detected ? 0.18 : 1.2} />
      <hemisphereLight args={['#e5edf2', '#303a37', props.detected ? 0.35 : 1.7]} />
      <directionalLight
        position={[0.2, 0.5, -0.2]}
        intensity={props.detected ? 2.3 : 3.2}
        castShadow={profile.shadows}
        shadow-mapSize={[profile.shadowMap, profile.shadowMap]}
        shadow-camera-left={-0.4}
        shadow-camera-right={0.4}
        shadow-camera-top={0.4}
        shadow-camera-bottom={-0.4}
        shadow-camera-near={0.01}
        shadow-camera-far={2}
        shadow-bias={-0.00008}
        shadow-normalBias={0.0006}
      />
      <directionalLight
        position={[-0.4, 0.2, 0.3]}
        intensity={props.detected ? 0.7 : 1.3}
        color={props.detected ? '#e1e8f0' : sceneColors.accent}
      />
      {props.detected && (
        <directionalLight position={[0, 0.3, -0.4]} intensity={1.3} color="#ffffff" />
      )}
      <group
        ref={hardwareRoot}
        scale={[
          props.detected ? 1 : (props.board?.visual.dimensions.width ?? 244) / 244,
          1,
          props.detected ? 1 : (props.board?.visual.dimensions.depth ?? 305) / 305,
        ]}
      >
        {!props.detected &&
          motherboardComponents.map((descriptor) => (
            <Region key={descriptor.id} descriptor={descriptor} props={props} />
          ))}
        {!props.detected && <Decorations lod={lod} />}
        {props.detected && (
          <DetectedComponents
            scene={props.detected}
            level={level}
            lod={lod}
            engine={motion}
            bindings={bindings}
          />
        )}
        {props.assembly && (
          <InstalledComponents
            assembly={props.assembly}
            reducedMotion={props.reducedMotion}
            exploded={props.exploded}
            onSelect={props.onSelect}
          />
        )}
      </group>
      {!props.detected && (
        <Grid
          position={[0, -0.013, 0]}
          args={[1.6, 1.6]}
          cellSize={0.025}
          sectionSize={0.1}
          cellColor={sceneColors.grid}
          sectionColor="#35403d"
          cellThickness={0.6}
          sectionThickness={0.9}
          fadeDistance={1.4}
          infiniteGrid
        />
      )}
      {profile.shadows && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, props.detected ? -0.004 : -0.012, 0]}
          receiveShadow
        >
          <planeGeometry args={[1.5, 1.5]} />
          <shadowMaterial opacity={props.detected ? 0.3 : 0.18} />
        </mesh>
      )}
      {props.detected && profile.effects && (
        <StudioContact motion={motion} key={`${level}-${props.detected.devices.length}`} />
      )}
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={0.12}
        maxDistance={1.4}
        maxPolarAngle={Math.PI * 0.85}
        target={[0, 0.012, 0]}
        onStart={() => {
          motion.cancelCamera();
        }}
      />
    </>
  );
}
export default function ExplorerRenderer(props: ExplorerRendererProps) {
  if (props.board) resolveVisualTemplate(props.board);
  const manager = useMemo(() => new AdaptiveQualityManager(), []);
  const pose = useRef<CameraPose | null>(null);
  const [motion] = useState(() => new MotionController());
  const [bindings] = useState(() => new MotionBindings());
  const [lifetime] = useState(() => ({ generation: 0 }));
  useEffect(() => {
    const generation = ++lifetime.generation;
    return () =>
      queueMicrotask(() => {
        if (lifetime.generation !== generation) return;
        motion.dispose();
        bindings.clear();
        window.dispatchEvent(
          new CustomEvent('cortex-motion-disposed', {
            detail: { activeHandles: motion.activeHandles, bindings: bindings.size },
          }),
        );
      });
  }, [motion, bindings, lifetime]);
  const [autoLevel, setAutoLevel] = useState<QualityLevel>('medium');
  const level = props.quality === 'auto' ? autoLevel : props.quality;
  const profile = qualityProfiles[level];
  return (
    <Canvas
      key={profile.antialias ? 'aa' : 'no-aa'}
      frameloop="demand"
      dpr={[1, profile.dpr]}
      shadows={profile.shadows ? { type: PCFShadowMap } : false}
      gl={{
        antialias: profile.antialias,
        powerPreference: 'default',
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
      camera={{ position: [0.32, 0.4, 0.36], fov: 42, near: 0.001, far: 10 }}
    >
      <Scene
        props={props}
        level={level}
        onLevel={setAutoLevel}
        manager={manager}
        pose={pose}
        motion={motion}
        bindings={bindings}
      />
    </Canvas>
  );
}
