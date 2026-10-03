# Audit evidence patterns

## Requirement matrix

| Requirement | Evidence | Status | Recommendation |
|---|---|---|---|
| A1 | `path:line`, symbol and payload/type | missing/partial/done | exact next location |

Use the brief's identifiers as row labels. Keep baseline and live-tree evidence separate when another actor changes files.

## Failure classification

- **Code failure:** reproducible assertion, type, syntax, or build error in the repository.
- **Test-harness failure:** the test cannot initialize because its mocks do not match production construction/import behavior.
- **Infrastructure symptom:** write/resource/environment issue; retry with a non-mutating diagnostic variation, then report the underlying result separately.

## Minimal command record

Record the exact command, working directory, relevant environment-only workaround, exit code, and compact real output. For test suites, record discovered file count and explicitly-run files that were absent from the default run.

## Concurrent-tree note

If `git status` changes during the audit, say: “Concurrent changes detected; no changes were made by the auditor,” then cite the observed `git diff` and avoid attributing those edits to the audit.
