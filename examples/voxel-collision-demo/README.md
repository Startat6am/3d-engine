# Voxel Collision Demo

A native Choreon voxel-world project for testing chunk rendering and static collision.

## Scene layout

- Four adjacent 16×16×16 chunks forming a continuous 32×32 ground platform.
- Y is the vertical axis: two stone foundation layers, a dirt layer, and a grass surface.
- A stepped raised platform near the center, plus two small test columns.
- One conventional Box mesh marker above the voxel surface, proving voxel chunks and ordinary mesh entities coexist in one project.
- Voxel size: 1 world unit.

## Open

1. Extract this folder.
2. In Player choose **Open project folder**.
3. Select the voxel-collision-demo directory.
4. The status should report **Voxel Collision Playground**, 4 voxel chunks, and 4 static voxel colliders.

Player restores the conventional Box entity alongside the four voxel chunks and creates one bounded static triangle-mesh collider per occupied chunk. The scene is a terrain/collision acceptance fixture; it does not yet include a controllable character.
