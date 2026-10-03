---
name: read-only-code-audit
description: "Evidence-driven, non-mutating audits of software repositories against a brief, acceptance criteria, or QA checklist."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [audit, code-review, qa, read-only, repository-inspection, verification]
    related_skills: [systematic-debugging, requesting-code-review, codebase-inspection]
---

# Read-Only Code Audit

## Trigger

Use when the user asks to audit, review, assess, or map implementation against a brief/acceptance document and explicitly says not to modify, commit, push, or deploy.

## Core contract

- Do not write project files, apply patches, generate build artifacts inside the repository, commit, push, migrate, or deploy.
- Deliver evidence, not a proposed implementation narrative: exact paths, symbols/functions, line ranges, current behavior, gaps, risks, and verification results.
- Treat the repository's current state as evidence, not as an invitation to fix it.

## Procedure

1. **Establish scope and baseline**
   - Read the requested brief completely.
   - Run `git status --short`, `git log --oneline -N`, and inspect the relevant tracked/untracked files.
   - Record uncommitted and untracked files before testing.

2. **Map requirements to code**
   - Search for each task identifier, function, model, endpoint, UI label, and test name.
   - Read complete relevant functions and adjacent types/schema definitions.
   - Report exact `path:line` locations and distinguish implemented, partial, and missing behavior.
   - Trace data across boundaries such as collector → persistence → pipeline → API → UI.

3. **Inventory verification**
   - Read package scripts and project configuration to identify canonical test, typecheck, lint, and build commands.
   - Run the existing suite and required build/typecheck commands without changing source.
   - Explicitly run newly discovered or untracked tests by path; a default test command may not exercise them.
   - If a command fails, capture the complete actionable error and separate setup/infrastructure symptoms from code/test failures. A temporary diagnostic workaround is acceptable only if it does not mutate the project.

4. **Audit tests as deliverables**
   - Verify that required test filenames exist at the exact requested paths.
   - Check that tests exercise the requested seam, not merely a nearby parser/helper.
   - Inspect mocks for compatibility with production construction patterns (`new`, static methods, module initialization).
   - Check assertions for the full contract: values, error fields, deduplication keys, skipped stages, and fallback/unknown cases.

5. **Handle concurrent changes safely**
   - Re-check `git status --short` before finalizing.
   - If files changed during the audit, capture `git diff` and label findings as baseline versus live-tree findings.
   - Never revert, overwrite, stage, or clean up another actor's changes.

6. **Report**
   - Start with a concise verdict and tree-state note.
   - Organize findings by the brief's task identifiers.
   - For each item include: exact path/lines, observed code, gap, likely failure mode, and concrete recommendation.
   - List commands and real outputs, including passed and failed scopes.
   - State explicitly that no files were changed or committed by the auditor.

## Common pitfalls

- Assuming `npm test` discovered every test file; verify the file list and run new tests explicitly.
- Confusing a raw payload containing a field with the normalized/public payload containing it.
- Reporting a flat status shape when the contract requires `{ status, error }` per source.
- Treating a helper unit test as proof that the production call path uses the helper.
- Ignoring absent configuration branches: skipped source calls can accidentally retain an initial `success` status.
- Mocking a constructor with an arrow function when production calls it with `new`.
- Reporting only the first snapshot/pipeline layer; trace persistence, API transformation, and UI rendering.
- Applying cleanup inside a per-period loop when the requirement says it is one-time per collection run.
- Treating a concurrent diff as your own change or silently auditing a moving target.

## Verification checklist

- [ ] Brief read completely
- [ ] Initial and final git status captured
- [ ] Every task mapped to exact files/functions/lines
- [ ] Required tests exist and are directly exercised
- [ ] Canonical test/build/typecheck commands identified and run
- [ ] Failures reproduced with actionable output
- [ ] Data flow traced across affected layers
- [ ] No project files, commits, or deployments performed

See `references/audit-evidence-patterns.md` for a compact reporting template and examples of failure classification.
