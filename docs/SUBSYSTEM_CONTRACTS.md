# Subsystem Contracts and Agent-Ready Documentation

**Status:** normative engineering design rule  
**Scope:** all engine packages, editor/player integrations, adapters, serialization formats, and project-authoring interfaces.

## 1. Core principle

Do not change the current implementation roadmap to accelerate AI features. Continue building the engine foundation in the approved sequence. However, every subsystem must be designed and implemented with clear contracts, machine-readable specifications where applicable, stable and actionable errors, examples, and automated tests.

Documentation is not an after-the-fact explanation. It is part of the subsystem's operational interface: it must let a developer, a test harness, or an AI agent discover what the subsystem can do, how to call it, what it guarantees, and how to recover from failure.

This is a quality requirement for ordinary engine development as well as a prerequisite for future AI authoring. It does not authorize moving AI milestones earlier or bypassing roadmap gates.

## 2. Required contract contents

Each public subsystem or adapter specification MUST define, as applicable:

1. **Purpose and boundaries** — responsibilities, non-goals, owning package, and dependencies.
2. **Capabilities** — the operations/features actually supported, distinguished from planned or experimental capabilities.
3. **Inputs and outputs** — types, units, coordinate conventions, defaults, valid ranges, nullability, and side effects.
4. **Machine-readable shape** — exported TypeScript types and, for persisted or externally exchanged data, a versioned JSON Schema or equivalent validator.
5. **Invariants** — state, lifecycle, identity, ownership, ordering, reference, and resource rules that callers may rely on.
6. **Errors** — stable error codes/categories, triggering conditions, relevant entity/asset/operation context, and recovery guidance. Error messages alone are not a contract.
7. **Examples** — minimal valid examples, common workflows, and examples of invalid input with expected diagnostics.
8. **Compatibility and versioning** — contract version, migration/deprecation policy, and compatibility expectations.
9. **Security and limits** — permissions, trust boundaries, resource budgets, and untrusted-input handling where relevant.
10. **Verification** — unit/contract/integration tests and acceptance criteria that demonstrate the documented guarantees.

Not every subsystem needs every artifact in a separate file. Keep the specification close to its owning package and link it from the documentation index. Avoid duplicating normative rules across documents; designate one source of truth and link to it.

## 3. Design for predictable execution

Prefer explicit, narrow, typed operations over ambiguous convenience APIs or arbitrary code execution. Operations should be composable and have observable outcomes. Where practical:

- make invalid states difficult to represent;
- validate at system boundaries, not only in UI controls;
- use deterministic behavior for the same valid input and state;
- make ownership, mutation, and disposal explicit;
- provide revision/conflict detection for edits to versioned documents;
- make multi-step mutations atomic or clearly report partial completion;
- provide idempotency or safe retry semantics where retries are expected;
- bound input size, work, memory, and execution time;
- return structured diagnostics with enough context for a caller to correct the request.

These principles improve reliability for all clients. They are not a promise that every visual or semantic outcome can be fully determined by schema validation.

## 4. Future AI and external-agent compatibility

Subsystem contracts should be consumable by future provider-neutral AI authoring tools without requiring a model to infer hidden engine behavior. The model should need to select and parameterize documented capabilities, not reproduce internal engine logic.

Future adapters may expose the same domain operations through:
- editor UI and command APIs;
- a project directory or scene files, including repositories hosted on GitHub;
- MCP servers and other tool protocols;
- provider-specific or local AI integrations.

MCP is optional, not the canonical source of truth. File-based workflows are also adapters and MUST use the same schemas, validation, permissions, diff/preview, transactional apply, and rollback rules. No adapter may bypass engine invariants by writing arbitrary internal state.

The future AI flow is staged: prompt interpretation → typed specification/plan → schema and policy validation → preview/diff → approval where required → deterministic execution → post-apply verification. Model output is untrusted input. The engine remains the source of truth.

Do not add AI-provider dependencies to engine-core or player runtime. Keep AI orchestration optional and outside frame-critical paths. See [AI Agent Authoring Specification](AI_AGENT_SPEC.md) for the planned authoring protocol and trust model.

## 5. Documentation structure and discoverability

- Maintain one normative specification per major subsystem or shared contract.
- Link every normative document from the README documentation index or a relevant parent specification.
- Keep examples executable or covered by tests when practical.
- Keep machine-readable schemas and implementation types version-aligned.
- Document unsupported capabilities and known limitations explicitly.
- Prefer small, capability-focused documents over one enormous prompt or manual.
- Update the contract, tests, examples, and implementation together when behavior changes.

## 6. Acceptance rule

A subsystem is not considered contract-complete merely because code exists or a prose description has been written. Its documented public surface, machine-readable validation where applicable, error behavior, examples, and automated tests must agree. Roadmap exit gates remain authoritative; this document does not mark any milestone complete.
