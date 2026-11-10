# Project Identity and Naming

**Status:** project naming adopted; the Choreonome format itself is not yet standardized or implemented.

## Names

| Name           | Meaning                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Choreon**    | The 3D engine, including its authoring and runtime ecosystem.                              |
| **Choreonome** | The planned declarative specification language for describing Choreon projects and scenes. |
| **.choreon**   | The planned file extension for Choreonome documents.                                       |

Use these spellings and capitalization consistently in user-facing documentation. Existing internal package names such as @engine/*, source directories, and the GitHub repository name are implementation identifiers and are not renamed by this decision.

## Format intent

Choreonome is intended to describe project and scene intent as structured, versioned data that can be validated and processed deterministically. It should be usable by the editor, direct project-file workflows (including Git-backed repositories), and optional integrations such as MCP or AI providers.

The intended authoring pipeline is:

**Prompt or human intent → Choreonome document → schema and semantic validation → preview/review → controlled execution → verification**

Natural-language or model-generated content is untrusted input. A valid document must not be treated as proof that the described scene is semantically correct. Validation, explicit capabilities, actionable diagnostics, preview and acceptance checks remain necessary. Integrations must not bypass engine invariants.

## Scope and compatibility

This naming decision does **not** define:

- a finalized Choreonome grammar or serialization encoding;
- a stable .choreon schema or compatibility guarantee;
- project-versus-scene document layouts;
- migration, import/export or validation behavior.

Those are future engineering contracts. Before .choreon files become public interchange artifacts, specify document kinds, schema/version identifiers, validation rules, migrations, error reporting, security limits and conformance fixtures. Keep the format aligned with [Subsystem Contracts](SUBSYSTEM_CONTRACTS.md) and [Data Format](DATA_FORMAT.md).

The engine must remain usable without an AI provider or MCP server. Direct project-file access is a supported future integration direction, but must go through the same schemas, validation, permissions, diff/preview and controlled-apply boundaries as other adapters.

## Naming boundaries

- **Choreon** names the product/engine, not a particular renderer or AI provider.
- **Choreonome** names the declarative specification, not an executable scripting language.
- **.choreon** is reserved as the intended extension; do not claim stable file-format support until the format contract is approved and implemented.
