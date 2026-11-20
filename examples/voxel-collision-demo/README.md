# Voxel Collision Demo

A native Choreon directory project with four adjacent 16×16×16 voxel chunks. It contains a layered ground slab, raised platforms, and stepped obstacles. Voxel size is 1 world unit.

## Use it in Player

1. Download and unzip `voxel-collision-demo.zip`.
2. In Player, choose **Open project** and select the extracted `voxel-collision-demo` folder.
3. The loaded status should report **4 static voxel colliders**.

The current Player integrates static voxel terrain into Rapier, but does not yet include a controllable character. This sample checks project loading and static collider creation, not character movement.
