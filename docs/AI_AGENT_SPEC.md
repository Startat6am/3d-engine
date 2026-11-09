# AI Agent Authoring Specification

**Status:** proposed baseline, approved for architectural planning; implementation pending.
**Version:** 0.1.0-draft

## 1. Purpose

Define a safe, provider-independent interface through which an AI agent can create, inspect, and modify engine content from natural-language prompts. The target workflows include:
- creating a single object or reusable prefab;
- creating a group of related objects;
- generating or editing a complete world/scene;
- modifying an existing scene without destroying unrelated content;
- iterating on a result using visual and structural feedback.

The feature is an authoring capability of the engine/editor, not an AI dependency of the runtime. Projects must remain fully usable when no model provider, network connection, or agent is available.

## 2. Non-goals

- The model does not directly execute arbitrary code, shell commands, scripts, SQL, or shader source in the editor process.
- The model is not the source of truth for world state; the validated engine document is.
- No specific LLM vendor, model, agent framework, or prompt syntax is mandatory.
- The first release does not promise autonomous asset creation for every asset type. Existing assets, procedural primitives, geometry recipes, and explicitly integrated generators are separate capabilities.

## 3. Architecture and trust boundaries

Flow:

`User Prompt -> Agent Orchestrator -> Intent/Plan -> Typed World Operations -> Policy + Schema Validation -> Preview/Diff -> User Approval -> Transactional Apply -> Save/Undo -> Validation Feedback`

Responsibilities:
- **AI Provider Adapter:** sends prompts/context and receives structured output; provider-specific SDKs stay outside engine-core.
- **Agent Orchestrator:** manages task state, context budget, tool permissions, retries, cancellation, and audit trail.
- **Scene Context Provider:** supplies a bounded, read-only snapshot: selected entities, hierarchy, relevant components, asset catalog, world settings, and capability summary.
- **Planning Layer:** converts intent into a typed, declarative operation plan.
- **Validation/Policy Layer:** checks schemas, IDs, references, limits, permissions, geometric bounds, and project constraints.
- **Preview Layer:** produces a human-readable summary and deterministic before/after diff.
- **Apply Layer:** applies approved operations as one undoable editor transaction.
- **Feedback Layer:** runs scene validation and optionally captures a preview image/render summary for another agent iteration.

No AI provider is imported by engine-core, player runtime, renderer backend, or serialization core. Editor owns orchestration and user consent. The provider adapter is replaceable.

## 4. Supported task modes

1. **Create:** create object(s), groups, prefabs, or a new world.
2. **Modify:** alter explicitly selected entities or a named region.
3. **Extend:** add content while preserving existing entities.
4. **Refactor:** reorganize hierarchy/components while preserving world-space appearance where requested.
5. **Explain/Inspect:** answer questions about the scene from read-only context without changing it.

The user prompt is natural language, but the model output is never applied as free-form text. All mutation is expressed through the operation schema below.

## 5. Prompt contract

Each task request includes:
- `taskId`, `projectId`, `worldId`, and current document revision;
- user prompt verbatim;
- mode (create/modify/extend/refactor/inspect);
- optional selection and target scope;
- relevant world settings (units, up axis, gravity, coordinate convention);
- available component types, geometry capabilities, and asset catalog entries;
- explicit constraints (style, dimensions, bounds, entity budget, performance budget);
- permission profile and requested output level;
- locale and optional reference images/asset references, if supported by the host.

The context provider MUST include only data needed for the task. Secrets, credentials, unrelated project files, and private environment variables are never exposed to a model.

### Example user prompt

"Create a small medieval market square in the selected empty area. Add a stone fountain in the center, four wooden stalls around it, lanterns, and a few crates. Keep all objects within 20 by 20 meters and make the scene editable."

The agent should resolve ambiguity conservatively, state assumptions (e.g. approximate dimensions and asset substitutions), and ask a clarifying question only when a missing decision materially changes the result.

## 6. Declarative operation model

The canonical agent output is a versioned JSON plan, not engine object instances or executable code.

Illustrative schema:

```json
{
  "protocol": "engine-agent-plan",
  "protocolVersion": "1.0.0",
  "taskId": "task:example",
  "baseRevision": 12,
  "summary": "Create a medieval market square",
  "assumptions": ["Use procedural primitives where no matching asset exists"],
  "operations": [
    {
      "op": "entity.create",
      "tempId": "fountain",
      "name": "Stone Fountain",
      "parent": null,
      "components": {
        "Transform": {
          "position": [0, 0, 0],
          "rotation": [0, 0, 0, 1],
          "scale": [1, 1, 1]
        },
        "MeshRenderer": {
          "geometry": { "kind": "primitive", "primitive": "cylinder" },
          "material": { "kind": "assetRef", "assetId": "asset:stone-material" }
        }
      }
    }
  ],
  "warnings": [],
  "requiredCapabilities": ["geometry.primitive", "material.reference"]
}
```

This is an illustrative payload; a normative JSON Schema and typed TypeScript definitions must be published in the implementation milestone. Temporary IDs are resolved to engine-generated IDs at apply time. Supported operations are allowlisted, such as `entity.create`, `entity.update`, `entity.delete`, `entity.reparent`, `component.set`, `component.remove`, `asset.reference`, and `world.settings.update`. The initial implementation should ship only the operations needed for safe creation and property editing.

The plan MUST NOT contain executable JavaScript, TypeScript, WASM, shader source, arbitrary URLs to fetch, or arbitrary filesystem paths. Geometry is expressed through supported recipes or references to registered assets.

## 7. Validation and policy

Before preview and again immediately before apply:
- validate protocol version and JSON schema;
- verify base revision has not changed; reject or re-plan on conflict;
- verify operation types and component schemas against engine registry;
- validate finite numeric values, quaternion normalization, positive/non-degenerate scale where required, and configured world bounds;
- enforce per-task entity, component, geometry, and operation budgets;
- verify referenced assets exist and are of the expected type;
- prevent hierarchy cycles and invalid parent references;
- enforce user scope: selected entities/region unless the user explicitly authorizes wider edits;
- reject unsupported or privileged component types;
- detect destructive changes and require explicit approval;
- reject untrusted instructions embedded in imported asset metadata or scene text that attempt to override system policy.

Unknown optional component payloads may be preserved but cannot be authored by the agent unless a registered schema and permission explicitly allow it.

## 8. Approval, transactions, undo, and provenance

Default policy:
- Read-only inspection can run without mutation approval.
- All mutations are previewed before application.
- Delete, overwrite, broad scene edits, project setting changes, and asset replacement require explicit approval.
- The user can approve all, approve selected operations, edit the plan, or reject it.
- Applying a plan is atomic: either the full validated transaction commits or no mutation is retained.
- One task creates one undo history transaction; undo restores the exact prior document state.
- Save is separate from apply unless the user explicitly enables an approved auto-save policy.

Record task ID, timestamp, provider/model identifier where available, prompt hash (not necessarily raw prompt), base revision, plan hash, applied operation summary, user approval, and result. Project settings control retention of raw prompts and provider responses. Do not store secrets or credentials in provenance.

## 9. Iterative generation and quality loop

After applying a plan, run deterministic validators:
- missing asset/reference check;
- transform/hierarchy integrity;
- component schema validation;
- world bounds and overlap warnings where supported;
- renderer capability/material compatibility;
- configured complexity budgets.

The agent may receive structured diagnostics and a preview render to propose a follow-up patch. Each follow-up is a new revision-checked plan and approval cycle. The system must not silently loop and mutate indefinitely. Limit iterations, token/context use, operation count, and total runtime.

## 10. Object and world generation policy

- Objects should be created from registered component/geometry/material capabilities.
- Reusable object assemblies may be saved as prefabs through a separately specified prefab asset contract.
- A full world plan may include environment settings, lighting, camera, geometry, asset references, and physics configuration, all through the same world schema.
- Voxel terrain is represented using the voxel package's registered component/asset contract; it is not a separate AI protocol.
- Mixed scenes may combine voxel and conventional mesh entities.
- Asset selection should prefer project-local registered assets; generated or downloaded assets require explicit configured providers and licensing/provenance metadata.
- The agent must disclose when it substitutes a primitive or placeholder for an unavailable requested asset.

## 11. Public API sketch

```ts
interface AgentAuthoringService {
  plan(request: AgentTaskRequest, signal?: AbortSignal): Promise<AgentPlan>;
  validate(plan: AgentPlan, context: AgentValidationContext): Promise<AgentValidationResult>;
  preview(plan: AgentPlan, context: AgentValidationContext): Promise<AgentPlanPreview>;
  apply(
    plan: AgentPlan,
    approval: AgentApproval,
    context: AgentApplyContext
  ): Promise<AgentApplyResult>;
  cancel(taskId: AgentTaskId): Promise<void>;
}
```

The interfaces are conceptual until implementation. Provider adapters implement a narrow structured-output contract. The authoring service lives in an editor/agent integration package, not engine-core. The engine applies only validated domain operations through editor command transactions.

## 12. Security and privacy

- Treat model output, prompts, asset metadata, imported documents, and provider responses as untrusted input.
- No arbitrary tool execution or unrestricted filesystem/network access.
- Use explicit allowlisted capabilities and least-privilege provider credentials.
- Do not send project content to a provider without a clear user-configured provider and disclosure/consent.
- Support local/mock provider adapters for offline tests and privacy-sensitive workflows.
- Redact credentials and sensitive metadata from logs.
- Enforce cancellation, timeouts, quotas, and bounded retries.
- Never let model text change policy, permissions, validation rules, or approval requirements.

## 13. Dependencies and performance

Depends on editor command/undo system, world serialization schema, component registry, asset registry, and renderer preview interface. Does not become a runtime dependency.

Measure prompt/context construction time, provider latency, schema-valid response rate, validation time, preview time, apply time, operation count, entity count, asset resolution latency, and token/cost usage where provider exposes it. Large scene context must be filtered and summarized; never serialize the entire project by default.

## 14. Errors

Stable error categories: provider unavailable, authentication/consent missing, timeout, cancellation, malformed output, unsupported protocol, stale revision, policy denied, schema invalid, missing asset, capability unavailable, budget exceeded, preview failed, transaction failed. Errors include task and operation IDs, but redact secrets and sensitive prompt content.

## 15. Testing and acceptance criteria

- Provider contract tests use deterministic mock adapters; CI does not require live model credentials.
- Golden prompt fixtures validate structured plans and protocol migrations.
- Fuzz tests cover malformed JSON, huge arrays, NaN/Infinity, invalid IDs, cycles, path traversal strings, and malicious instructions in imported metadata.
- Policy tests prove that delete/overwrite and out-of-scope edits cannot bypass approval.
- Transaction tests prove atomic apply and exact undo/redo.
- Revision conflict tests reject stale plans.
- E2E tests create a primitive object and a small multi-object scene from prompts, preview, approve, undo, redo, save, and reopen.
- A mixed voxel + mesh world fixture proves representation independence.
- Acceptance requires provider-offline editor functionality, no model SDK in player/core bundles, and reproducible test results.

## 16. Open decisions for implementation

1. Whether the first provider integration is hosted, local, or both; keep interface neutral.
2. Whether image input is in MVP or a later capability.
3. Which initial component and geometry recipes are safe to expose.
4. Whether prefab authoring is included in first object-generation release.
5. Project-level retention defaults for prompts and agent traces.

These are implementation decisions and must be recorded as ADRs before provider-specific integration.
