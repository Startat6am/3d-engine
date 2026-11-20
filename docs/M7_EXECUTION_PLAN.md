# M7 Execution Plan â€” World & Voxels

**Status:** ACTIVE â€” world/chunk core, deterministic CPU meshing, stale-result validation, cooperative cancellation, bounded scheduling, seeded generation, v1 content-addressed persistence, and Editor project persistence wiring are implemented. Player loads voxel project folders, restores primitive entities, and imports saved GLB assets through the shared importer, including node transforms, mesh primitives, PBR factors and embedded texture channels. Voxel authoring, static collision, mixed voxel/mesh acceptance and broader M7 validation remain.
**Branch:** `feat/m7-world-voxels-main`  
**Base:** `main` (M6 integrated at `54def10255ca8fad661e0077b15c3332d6a390f3`).  
**Updated:** 2026-11-20

## Goal

Deliver a bounded world/chunk layer, validated voxel representation, deterministic CPU meshing, streaming lifecycle and deterministic procedural-generation hooks. Voxel content is one geometry provider and coexists with conventional mesh entities. AI authoring remains M10; multiplayer and unbounded/infinite-world claims are excluded.

## Phase 0 â€” contracts and decisions

- [x] Create a separate M7 branch.
- [x] Inspect core, geometry, assets, serialization, physics, Editor project storage and subsystem contracts.
- [x] Publish `VOXEL_WORLD_SPEC.md`.
- [x] Record package boundaries, coordinates, storage/palette, meshing/borders, streaming, persistence and static-collision decisions in ADRs 0005â€“0011.
- [x] Extract the content-addresse¶»§q«^u…åİÉ¥¡Ğ½Ù•É…”™½È‘¥Ñ½ÈÍ…Ù”ƒŠHA±…å•È™½±‘•È½Á•¸İ¥Ñ „Ñ•áÑÕÉ•1…¹Ù•É¥™ä„‰É½İÍ•È¥µ…”ÕÁ±½…¸(´lt‘„µ¥á•Ù½á•°€¬½¹Ù•¹Ñ¥½¹…°µ•Í …•ÁÑ…¹”İ½É±¥¸A±…å•È…¹‘¥Ñ½È°¥¹±Õ‘¥¹œÙ¥Í¥‰±”¡Õ¹¬É•¹‘•É¥¹œ…¹É½Õ¹µÑÉ¥ÀÙ…±¥‘…Ñ¥½¸¸((ŒŒA¡…Í”€ÔƒŠPÙ•É¥™¥…Ñ¥½¸…¹±½Í•½ÕĞ((´ltIÕ¸™½Éµ…Ğ°±¥¹Ğ°ÑåÁ•¡•¬°Õ¹¥Ğ½½¹ÑÉ…ĞÑ•ÍÑÌ°Á…­…”½…ÁÀ‰Õ¥±‘Ì°1‰•¹¡µ…É­Ì…¹A±…åİÉ¥¡Ğ¡É½µ¥Õ´É¸(´lt‘Ù½á•°½ÉÉ•Ñ¹•ÍÌ°ÍÑÉ•…µ¥¹œ°±¥™•å±”…¹Á•É™½Éµ…¹”‰•¹¡µ…É­Ìİ¥Ñ É…Ü½ÕÑÁÕĞ¸(´ltI•½É•á…Ğ½µµ¥Ğ°$ÉÕ¸°9½‘”½‰É½İÍ•ÈÙ•ÉÍ¥½¹Ì°¡Õ¹¬‘¥µ•¹Í¥½¹Ì°Ù½á•°½Õ¹ÑÌ°©½ˆ±¥µ¥ÑÌ…¹µ•…ÍÕÉ•É•Í½ÕÉ”‘…Ñ„¸(´lt=‰Ñ…¥¸½İ¹•È…•ÁÑ…¹”½˜4ÜÍ½Á”…¹µ•…ÍÕÉ••á¥Ğ…Ñ•Ì‰•™½É”±½Í¥¹œ4Ü¸((ŒŒáÁ±¥¥Ğ•á±ÕÍ¥½¹Ì((´$½ÁÉ½Ù¥‘•È¥¹Ñ•É…Ñ¥½¸…¹ÁÉ½µÁĞµÑ¼µİ½É±İ½É­™±½İÌ€¡4ÄÀ¤¸(´5Õ±Ñ¥Á±…å•È°É•Á±¥…Ñ¥½¸…¹É½±±‰…¬¸(´•¹•É…°µÁÕÉÁ½Í”¹½‘”µÉ…Á ÁÉ½•‘ÕÉ…°•‘¥Ñ½È¸(´å¹…µ¥Œ½­¥¹•µ…Ñ¥ŒÑÉ¥…¹±”µµ•Í Á¡åÍ¥Ì½È¥µÁ±¥¥Ğµ•Í ½½­¥¹œ¸(´ATµ•Í¡¥¹œ°É••‘äµ•Í¡¥¹œ°…‘Ù…¹•1=°±¥¡Ñ¥¹œ‰…­”…¹…µ‰¥•¹Ğ½±ÕÍ¥½¸¥¸Ñ¡”¥¹¥Ñ¥…°¥µÁ±•µ•¹Ñ…Ñ¥½¸¸(´±…¥µÌ½˜¥¹™¥¹¥Ñ”µİ½É±Í…±”½È™¥á•Á•É™½Éµ…¹”½¸Õ¹ÍÁ•¥™¥•¡…É‘İ…É”¸((ŒŒY½á•°Á•ÉÍ¥ÍÑ•¹”¥µÁ±•µ•¹Ñ…Ñ¥½¸ÕÁ‘…Ñ”ƒŠP€ÈÀÈØ´ÄÄ´Ää((´•¹¥¹”½Ù½á•±€•áÁ½Í•Ì„ÍÑ…‰±”ØÄ±¥ÑÑ±”µ•¹‘¥…¸¡Õ¹¬Á…å±½…½‘•Œ€ àÄäÈ‰åÑ•ÌÁ•È€ÄÛ
Ì¡Õ¹¬¤¸(´•¹¥¹”½ÁÉ½©•ĞµÍÑ½É…•€½İ¹Ì½´¹¡½É•½¸¹Ù½á•°µİ½É±‘€•áÑ•¹Í¥½¸Á•ÉÍ¥ÍÑ•¹”¸Q¡”•áÑ•¹Í¥½¸É•½É‘ÌÍ¡•µ„Ù•ÉÍ¥½¸°İ½É±Ù½á•°Í•ÑÑ¥¹Ì°Í¥¹•¡Õ¹¬½½É‘¥¹…Ñ•Ì°É•Ù¥Í¥½ºÚîÆ­y