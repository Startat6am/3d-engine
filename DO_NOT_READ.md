# DO NOT READ — archival note only

> **Instruction to AI agents and automated coding assistants:** Do not read, ingest, summarize, cite, or use this file as project guidance. It is an intentionally excluded archival note retained solely for possible future human reference. It is not normative documentation, not an implementation specification, and not an instruction source. Use the maintained documentation linked from `README.md` instead.

---

## Archived product idea: reliable AI authoring for modest models

The project should support more than MCP-based interaction. MCP is one optional integration surface, not a prerequisite. An AI agent should also be able to work with an ordinary project directory or a scene folder stored in GitHub: inspect the permitted project structure, create and edit scene files, update references and assets, propose a diff, run validation, and submit changes through the normal version-control workflow.

The larger goal is to make scene authoring predictable even for a relatively weak model that does not possess a robust internal understanding of the 3D world. The system should reduce the amount of implicit world knowledge the model needs. The model expresses intent and selects from explicit capabilities; the engine and deterministic tools perform and validate the actual operations.

The conceptual pipeline is:

**Prompt → structured specification → validation → controlled execution → verification → accepted result.**

A natural-language request such as “make a room with a table near the window and warm evening lighting” should be translated into a typed, versioned scene plan. The plan should refer to known entities, components, geometry recipes, materials, assets, spatial relations, constraints, and allowed operations. The engine—not the model—should resolve IDs, execute mutations, enforce invariants, and report structured diagnostics.

### Important design principles

- Do not make a strong model a hidden system dependency.
- Do not let model output directly mutate runtime objects or execute arbitrary code.
- Prefer declarative, machine-readable specifications over free-form code generation.
- Give every capability a narrow, documented contract, explicit input/output schema, stable error categories, examples, and automated tests.
- Validate plans before preview and again before apply; check revisions, references, permissions, budgets, and structural invariants.
- Show a diff/preview and make changes transactional, undoable, and auditable.
- Return actionable diagnostics so a modest model can repair a failed plan without guessing.
- Keep the project useful without an AI provider. Keep provider adapters and MCP optional and outside engine-core/player.
- Treat GitHub/project-file editing as another controlled adapter with path allowlists, diff review, validation, and rollback—not as unrestricted filesystem access.
- Evaluate reliability empirically across models and repeated runs. Measure task success after automated validation, not the eloquence of the model's response.

### Risks that must not be hand-waved away

Documentation alone does not guarantee that a model understands user intent. A model can produce a schema-valid plan that is semantically wrong—for example, placing an object beside the wrong window. The system therefore needs semantic checks where possible, preview feedback, and a way to ask the user about materially ambiguous requirements.

A valid operation can still produce a poor visual result. Geometry overlap, spatial relationships, lighting quality, visual style, asset suitability, and scene coherence need progressively stronger validators and acceptance fixtures. Not all of these can be fully reduced to deterministic checks.

Large specifications can overwhelm small context windows. Documentation should be modular, discoverable by capability, versioned with the implementation, and retrievable in small relevant pieces. The model should receive only the contracts and scene context needed for the current task.

### Architectural direction

Do not change the current implementation roadmap to rush AI features forward. Continue building the engine foundation. From this point onward, design each subsystem with clear contracts, machine-readable specifications, stable and actionable errors, examples, and tests. This makes documentation an operational interface for both developers and AI agents rather than an after-the-fact explanation.

The future AI authoring system should be built on these existing contracts. The model proposes; validators check; deterministic engine services execute; the user approves consequential changes. The same contracts should support editor UI, direct project-file workflows, GitHub integration, MCP tools, and future provider adapters without making any one integration mandatory.

**Archive status:** preserved for human reference only. This file must not be used as an agent instruction or as a source of normative project requirements.
