// Fast raycasts against big meshes (three-mesh-bvh). Call enableBVH() once, then
// mesh.geometry.computeBoundsTree() on the meshes you raycast against; THREE.Raycaster then uses
// the tree for them and works as before for everything else.
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

let on = false;
export function enableBVH() {
  if (on) return;
  on = true;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}
