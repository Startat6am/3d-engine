# Public API Specification

**Status:** proposed contracts; names are illustrative until the API review.

## Purpose and responsibility

Define supported package entry points and compatibility guarantees. Internal implementation modules are not public API.

## Initial surface

```ts
interface EngineHost {
  readonly capabilities: EngineCapabilities;
  start(options?: EngineStartOptions): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
interface World {
  readonly id: WorldId;
  createEntity(name?: string): EntityId;
  destroyEntity(id: EntityId): void;
  query<T extends ComponentType[]>(...types: T): EntityQuery<T>;
}
interface Renderer {
  readonly backend: 'webgl2' | 'webgpu';
  readonly capabilities: RendererCapabilities;
  render(input: RenderFrame): void;
  resize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}
```

## AI authoring surface (conceptual)

The provider-neutral authoring package exposes a staged plan/validate/preview/apply lifecycle. It must not expose a direct "prompt mutates world" shortcut.

```ts
interface AgentAuthoringService {
  plan(request: AgentTaskRequest, signal?: AbortSignal): Promise<AgentPlan>;
  validate(plan: AgentPlan, context: AgentValidationContext): Promise<AgentValidationResult>;
  preview(plan: AgentPlan, context: AgentValidationContext): Promise<AgentPlanPreview>;
  apply(
    plan: AgentPlan,
    approval: AgentApproval,
    context: AgentApplyContext,
  ): Promise<AgentApplyResult>;
  cancel(taskId: AgentTaskId): Promise<void>;
}
```

Normative operation protocol, validation, consent, privacy, provenance, and acceptance criteria live in [AI_AGENT_SPEC.md](AI_AGENT_SPEC.md). These signatures remain illustrative until implementation and API review.

## Rules

- Follow [Subsystem Contracts](SUBSYSTEM_CONTRACTS.md): public API behavior, input/output shapes, invariants, stable errors, examples, compatibility, and tests are specified together. Persisted or externally exchanged payloads require versioned machine-readable schemas or equivalent validators.

- Public imports come from package root exports; deep imports are unsupported.
- IDs are opaque branded values, not array indexes.
- Async I/O is explicit; cancellation uses AbortSignal where applicable.
- Resource disposal is explicit and idempotent.
- Runtime APIs do not expose React or Three.js types.
- No synchronous network/file loading in frame callbacks.
- Errors use stable error codes; messages may evolve.
- Semver: additive compatible API in minor releases; breaking changes require major version and migration notes. Draft pre-1.0 contracts may change with ADR and changelog.

## Dependencies

Core contracts are dependency-light. Feature packages depend on core; editor app depends on engine-editor and React; player app depends only on runtime-facing packages. Agent provider adapters remain optional and editor-side.

## Performance

API design must permit batch operations, typed-array geometry, query iteration without materializing arrays, and allocation-free paths where benchmarks identify hot loops. Agent tasks are asynchronous, cancellable, quota-limited, and excluded from frame-critical loops.

## Error and test policy

Validate invalid IDs, disposed resources, unsupported capabilities, and invalid lifecycle transitions. Type-level tests assert exported types; API tests import only package root entry points. Agent contract tests use mock providers and verify stale revision rejection, approval enforcement, transaction atomicity, and exact undo.

## Acceptance

Every exported symbol is documented, has an owning package, tested lifecycle/error behavior, and an explicit stability classification (internal, experimental adapter, or stable public).
