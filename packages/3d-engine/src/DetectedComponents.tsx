import { useLayoutEffect, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { InstancedMesh, Matrix4 } from 'three';
export interface DetectedVisual {
  category: 'cpu' | 'gpu' | 'memory' | 'storage';
  index: number;
}
export interface DetectedScene {
  devices: DetectedVisual[];
  onSelect(category: DetectedVisual['category'], index: number): void;
}
function Box({
  size,
  position,
  color,
  metal = 0.25,
}: {
  size: [number, number, number];
  position?: [number, number, number];
  color: string;
  metal?: number;
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.42} metalness={metal} />
    </mesh>
  );
}
function FanBlades() {
  const ref = useRef<InstancedMesh>(null);
  const { invalidate } = useThree();
  useLayoutEffect(() => {
    const matrix = new Matrix4();
    for (let i = 0; i < 9; i++) {
      const angle = (i * Math.PI * 2) / 9;
      matrix.makeRotationY(angle);
      matrix.setPosition(
        0.012 * Math.cos(angle) + 0.005 * Math.sin(angle),
        0.002,
        -0.012 * Math.sin(angle) + 0.005 * Math.cos(angle),
      );
      ref.current?.setMatrixAt(i, matrix);
    }
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [invalidate]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 9]} raycast={() => null}>
      <boxGeometry args={[0.007, 0.002, 0.025]} />
      <meshStandardMaterial color="#60716b" roughness={0.42} metalness={0.25} />
    </instancedMesh>
  );
}
export default function DetectedComponents({ scene }: { scene: DetectedScene }) {
  return (
    <>
      {scene.devices.map(({ category, index }) => {
        // This is an illustrative category layout, never a claim about sockets, slots or form factor.
        const position: [number, number, number] =
          category === 'cpu'
            ? [-0.022 + index * 0.06, 0.016, -0.066]
            : category === 'memory'
              ? [0.048 + (index % 4) * 0.014, 0.03, -0.058 + Math.floor(index / 4) * 0.16]
              : category === 'gpu'
                ? [-0.015, 0.045 + index * 0.052, 0.046]
                : [-0.08 + index * 0.056, 0.012, 0.22];
        return (
          <group
            key={`${category}-${index}`}
            position={position}
            userData={{ detectedCategory: category, detectedIndex: index }}
            onClick={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (e.delta > 5) return;
              scene.onSelect(category, index);
            }}
          >
            {category === 'cpu' ? (
              <>
                <Box size={[0.041, 0.006, 0.041]} color="#c5cece" metal={0.85} />
                <Box
                  size={[0.03, 0.001, 0.03]}
                  position={[0, 0.0036, 0]}
                  color="#9faeae"
                  metal={0.8}
                />
              </>
            ) : category === 'memory' ? (
              <>
                <Box size={[0.007, 0.037, 0.133]} color="#376454" />
                <Box
                  size={[0.008, 0.004, 0.124]}
                  position={[0, -0.019, 0]}
                  color="#bc9b50"
                  metal={0.7}
                />
                {[-1, 1].map((sign) => (
                  <Box
                    key={sign}
                    size={[0.002, 0.024, 0.048]}
                    position={[0.004, 0, sign * 0.031]}
                    color="#1c2b26"
                  />
                ))}
              </>
            ) : category === 'gpu' ? (
              <>
                <Box size={[0.21, 0.03, 0.082]} color="#273436" metal={0.6} />
                <Box size={[0.208, 0.002, 0.079]} position={[0, -0.017, 0]} color="#436553" />
                {[-1, 1].map((sign) => (
                  <group key={sign} position={[sign * 0.053, 0.017, 0]}>
                    <mesh>
                      <cylinderGeometry args={[0.032, 0.032, 0.003, 32]} />
                      <meshStandardMaterial color="#131d1c" />
                    </mesh>
                    <FanBlades />
                    <mesh position={[0, 0.004, 0]}>
                      <cylinderGeometry args={[0.008, 0.008, 0.003, 16]} />
                      <meshStandardMaterial color="#a2b69b" metalness={0.7} roughness={0.4} />
                    </mesh>
                  </group>
                ))}
              </>
            ) : (
              <>
                <Box size={[0.044, 0.014, 0.07]} color="#667570" metal={0.8} />
                <Box size={[0.03, 0.001, 0.041]} position={[0, 0.008, 0]} color="#26382f" />
              </>
            )}
          </group>
        );
      })}
    </>
  );
}
