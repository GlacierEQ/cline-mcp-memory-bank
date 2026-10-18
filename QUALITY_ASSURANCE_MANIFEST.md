# Quality Assurance Manifest

**Project:** memory-bank-server
**Version:** 0.2.0
**Last audited:** 2026-10-18
**Scope:** MCP server, CLI, tool/resource handlers, packaging, CI

## Verified checks

| Check | Command | Result |
| --- | --- | --- |
| TypeScript build | `npm run build` | Pass |
| Unit/integration tests | `npm test` | Pass (6 tests) |
| Production dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |
| MCP stdio handshake | `Client` from `@modelcontextprotocol/sdk` | Pass |
| CLI initialization | `node build/index.js initialize_memory_bank <dir>` | Pass |
| Package contents | `npm pack --dry-run` | `build/`, `README.md`, `LICENSE` |

## Audit findings fixed in 0.2.0

1. **Data loss on re-initialization** — initialization overwrote every memory bank file. Existing files are now preserved unless `force: true` is passed.
2. **Relative path bug** — files were created relative to the server process instead of the requested project. Paths are resolved to absolute directories and validated.
3. **Invalid MCP settings entry** — the generated command pointed at `<project>/build/index.js`, which does not exist for user projects. It now points at this server's own entry point and sets `PROJECT_PATH`.
4. **Narrow settings discovery** — only VS Code Insiders was supported. Stable VS Code, Insiders, Cursor, and Windsurf are detected, with `CLINE_MCP_SETTINGS_PATH` as an override; writes are atomic and preserve unrelated settings.
5. **Wrong decision section** — proposed decisions were appended to Technical Decisions. They now go to Pending Decisions.
6. **Unbounded project scan** — stack detection walked `node_modules` and build output. It now skips generated/vendor directories, ignores symlinks, and caps traversal.
7. **Unsafe async bookkeeping** — a fire-and-forget progress auto-save could write to the wrong project and race with the caller. The unused counter path was removed.
8. **No regression coverage** — added end-to-end tests covering the CLI, MCP tools, resources, path handling, and data preservation, plus `npm run ci`, `make ci`, and a hosted workflow template at `docs/ci-workflow.yml`.
9. **Stale/insecure SDK** — `@modelcontextprotocol/sdk` updated to 1.32.1; engines raised to Node.js >= 18.

## Known limitations

- MCP resources read the most recently initialized project, then `PROJECT_PATH`, then the current working directory. MCP resource URIs cannot carry a project path.
- macOS and Windows settings paths are implemented but CI runs on Linux.
- Publishing to npm requires repository credentials; CI verifies build/test/audit only.
