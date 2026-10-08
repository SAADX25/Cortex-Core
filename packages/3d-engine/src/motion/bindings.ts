import { Color, type Group, MeshStandardMaterial } from 'three';
import type { MotionController } from './controller';
/** Sole writer of detected visual transforms and focus tint. Does not own GPU allocations. */
export class MotionBindings {
  private groups = new Map<
    string,
    { group: Group; materials: { material: MeshStandardMaterial; base: Color }[] }
  >();
  attach(id: string, group: Group) {
    const materials = new Map<string, { material: MeshStandardMaterial; base: Color }>();
    group.traverse((object) => {
      if (!('material' in object)) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list)
        if (material instanceof MeshStandardMaterial) {
          const base = material.userData.motionBaseColor ?? material.color.clone();
          material.userData.motionBaseColor = base;
          materials.set(material.uuid, { material, base });
        }
    });
    this.groups.set(id, { group, materials: [...materials.values()] });
  }
  detach(id: string) {
    this.groups.delete(id);
  }
  apply(controller: MotionController) {
    for (const [id, { group, materials }] of this.groups) {
      const visual = controller.visual(id);
      if (!visual) continue;
      group.position.fromArray(visual.position);
      group.rotation.set(...visual.rotation);
      for (const { material, base } of materials)
        material.color.copy(base).multiplyScalar(visual.intensity);
    }
  }
  clear() {
    this.groups.clear();
  }
  get size() {
    return this.groups.size;
  }
}
