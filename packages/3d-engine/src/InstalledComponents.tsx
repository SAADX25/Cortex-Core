import { useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, MeshStandardMaterial } from 'three';
import type { Part } from '@cortex/part-schema';
import type { Build, SlotId } from '@cortex/build-domain';
import { installationPose, type InstallationPhase } from './installation';

export interface AssemblyScene {
  installations: Build['installations'];
  transitions: {
    slotId: SlotId;
    partId: string;
    phase: 'installing' | 'removing';
    startedAt: number;
  }[];
  preview: { slotId: SlotId; partId: string } | null;
  validSlots: SlotId[];
  catalog: Part[];
}
function InstalledVisual({
  slotId,
  part,
  phase,
  startedAt,
  reducedMotion,
  exploded,
  onSelect,
}: {
  slotId: SlotId;
  part: Part;
  phase: InstallationPhase;
  startedAt: number;
  reducedMotion: boolean;
  exploded: boolean;
  onSelect(id: SlotId): void;
}) {
  const group = useRef<Group>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const { invalidate } = useThree();
  const apply = (elapsed: number) => {
    const pose = installationPose(slotId, phase, elapsed, reducedMotion, exploded);
    group.current?.position.set(
      ...(pose.position.map((v) => v / 1000) as [number, number, number]),
    );
    group.current?.rotation.set(...pose.rotation);
    if (material.current) material.current.opacity = pose.opacity;
    return pose.done;
  };
  useLayoutEffect(() => {
    apply(performance.now() - startedAt);
    invalidate();
    // The same pose evaluator drives initial placement and every animation frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId, phase, startedAt, reducedMotion, exploded, invalidate]);
  useFrame(() => {
    if (!apply(performance.now() - startedAt)) invalidate();
  });
  const ram = part.category === 'ram';
  const m2 = part.category === 'storage';
  const ghost = phase === 'preview';
  // All declarative geometries/materials are owned and disposed by R3F on unmount. No textures or external assets.
  return (
    <group
      ref={group}
      userData={{ semanticId: slotId, partId: part.id, phase }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.delta > 5) return;
        onSelect(slotId);
      }}
    >
      <mesh position={m2 ? [0.04, 0, 0] : [0, 0, 0]} castShadow={!ghost}>
        <boxGeometry
          args={ram ? [0.006, 0.035, 0.133] : m2 ? [0.08, 0.003, 0.022] : [0.04, 0.005, 0.04]}
        />
        <meshStandardMaterial
          ref={material}
          color={ghost ? '#9bbeb2' : ram || m2 ? '#35685b' : '#b5bfc0'}
          roughness={0.45}
          metalness={ram || m2 ? 0.2 : 0.8}
          transparent={ghost || phase === 'removing'}
          depthWrite={!ghost && phase !== 'removing'}
        />
      </mesh>
      {!ghost && (
        <>
          {ram ? (
            <mesh position={[0, -0.015, 0]}>
              <boxGeometry args={[0.0065, 0.004, 0.125]} />
              <meshStandardMaterial color="#bb9b54" metalness={0.6} />
            </mesh>
          ) : null}
          {(ram || m2) &&
            [-1, 1].map((sign) => (
              <mesh
                key={sign}
                position={ram ? [0.004, 0, sign * 0.039] : [0.04 + sign * 0.016, 0.002, 0]}
              >
                <boxGeometry args={ram ? [0.003, 0.019, 0.027] : [0.012, 0.002, 0.015]} />
                <meshStandardMaterial color="#192624" />
              </mesh>
            ))}
        </>
      )}
    </group>
  );
}
export default function InstalledComponents({
  assembly,
  reducedMotion,
  exploded,
  onSelect,
}: {
  assembly: AssemblyScene;
  reducedMotion: boolean;
  exploded: boolean;
  onSelect(id: SlotId): void;
}) {
  const items = [
    ...assembly.installations,
    ...assembly.transitions.filter((t) => t.phase === 'removing'),
  ];
  return (
    <>
      {items.map((item) => {
        const part = assembly.catalog.find((p) => p.id === item.partId);
        const transition = assembly.transitions.find((t) => t.slotId === item.slotId);
        return part ? (
          <InstalledVisual
            key={item.slotId}
            slotId={item.slotId}
            part={part}
            phase={transition?.phase ?? 'installed'}
            startedAt={transition?.startedAt ?? 0}
            reducedMotion={reducedMotion}
            exploded={exploded}
            onSelect={onSelect}
          />
        ) : null;
      })}
      {assembly.preview &&
        (() => {
          const part = assembly.catalog.find((p) => p.id === assembly.preview!.partId);
          return part ? (
            <InstalledVisual
              key="preview"
              slotId={assembly.preview.slotId}
              part={part}
              phase="preview"
              startedAt={0}
              reducedMotion={reducedMotion}
              exploded={exploded}
              onSelect={onSelect}
            />
          ) : null;
        })()}
    </>
  );
}
