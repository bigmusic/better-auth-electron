# Better Auth v1.5.x Adaptation Plan for `@bigio/better-auth-electron` (Personal Plugin)

## 1. Objective
Upgrade and harden this personal Electron plugin so it remains stable with Better Auth `v1.5.x` (target `v1.5.3` as of March 4, 2026), without changing the plugin's public behavior for existing consumers.

This plan is strictly for your plugin codebase. It does not adopt, benchmark, or track the official `@better-auth/electron` package.

## 2. Goal and Non-Goal
Goal:
- Ensure this plugin adapts to Better Auth internal/core API and runtime changes introduced in `v1.5.x`.
- Keep your existing custom OAuth handoff architecture (IPC + deep link + ticket exchange).
- Preserve current public API surface and expected runtime flow.

Non-goal:
- Replacing your plugin API with an official API shape.
- Refactoring architecture beyond compatibility needs.
- Adding unrelated features.
- Making implementation decisions based on official Electron plugin internals.

## 3. Version Target and Time Context
- Previous baseline in this repo: Better Auth `^1.4.18` in [package.json](/Volumes/BiGROG/open-source/better-auth-electron/package.json:36).
- Upgrade compatibility target: Better Auth `1.5.3`.
- Patch timeline used in this plan:
- `v1.5.0` on March 1, 2026.
- `v1.5.1` on March 2, 2026.
- `v1.5.2` on March 3, 2026.
- `v1.5.3` on March 4, 2026.

## 4. Current Architecture Baseline (Repo-Specific)
Primary files:
- Server plugin: [src/server/electron-server-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/server/electron-server-plugin.ts)
- Renderer plugin: [src/renderer/electron-renderer-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/renderer/electron-renderer-plugin.ts)
- Web handoff plugin: [src/web/electron-web-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/web/electron-web-plugin.ts)
- Default contracts/options: [src/options/electron-plugin-options.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/options/electron-plugin-options.ts)
- Main process integration: [src/main/electron-main-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/main/electron-main-plugin.ts)

Current sensitive integration points:
- Server-side context internals:
- `ctx.context.internalAdapter.findSession(...)` and `findUserById(...)`.
- `ctx.context.internalAdapter.createSession(...)`.
- `ctx.context.authCookies.sessionToken`.
- `ctx.context.responseHeaders` interception and mutation.
- Cookie extraction and rewriting:
- `headers.getSetCookie()` requirement and multi-cookie processing.
- Regex extraction of session token from `Set-Cookie`.
- Client/store internals:
- Renderer uses `$store.notify('$sessionSignal')`.
- Web plugin casts `$store.atoms.session` to a specific shape.
- OAuth flow dependencies:
- `client.signIn.social(...)` callback URLs and status forwarding.
- Strict URL/search-param schema for `scheme`, `provider`, `challenge`, `status`, `ticket`.

## 5. Better Auth v1.5.x Changes That Matter for This Plugin
This section intentionally lists only changes with direct or likely impact to your custom plugin behavior.

1. Deprecated API/type removals in `v1.5.0`.
- Potential compile-time break risk for projects depending on removed deprecated symbols.
- Your repo appears mostly unaffected by direct symbol usage, but compatibility guards are still required around imported Better Auth client/server types.

2. Hook and internal timing semantics changed in `v1.5.0`.
- After hooks run after transaction completion.
- This can affect assumptions about session visibility timing and callback sequencing in custom endpoint/hook logic.

3. Client typing/import corrections in `v1.5.1`.
- Important for plugin code that leans on typed client actions and inferred atom/store shapes.
- Your web/renderer layers rely on Better Auth client typings and should be validated in strict typecheck.

4. Cookie behavior fixes in `v1.5.2`.
- Important for this plugin because server flow intercepts and rewrites `Set-Cookie` and extracts session token.
- Upstream cookie splitting/encoding fixes can invalidate old assumptions in regex/decoding paths.

5. Additional patch corrections in `v1.5.3`.
- Lower direct impact, but still part of target baseline verification for runtime and type stability.

Out of scope in this section:
- Official Electron plugin package behavior, architecture, or migration path.

## 6. Compatibility Risk Matrix
| Area | Where in repo | Risk | Why it can break in v1.5.x | Required mitigation |
|---|---|---|---|---|
| Server context internals | [src/server/electron-server-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/server/electron-server-plugin.ts:121) | High | Internal context field shape/availability may shift | Introduce guarded access helpers and explicit invariant errors |
| Session creation assumptions | [src/server/electron-server-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/server/electron-server-plugin.ts:397) | Medium | Session creation internals may have behavior changes | Validate session object fields and cookie signing path in tests |
| Cookie header parsing | [src/server/electron-server-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/server/electron-server-plugin.ts:60) | High | Multi-cookie and encoding behavior changed upstream | Replace brittle parsing with robust normalization utility |
| Token extraction regex | [src/server/electron-server-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/server/electron-server-plugin.ts:196) | Medium | Cookie key/value format may vary | Add fallback parser strategy and explicit failure telemetry |
| Response header mutation | [src/server/electron-server-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/server/electron-server-plugin.ts:265) | Medium | Header behavior differences can break flow | Guard `responseHeaders` lifecycle and mutation order |
| Renderer refetch signal | [src/renderer/electron-renderer-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/renderer/electron-renderer-plugin.ts:120) | Medium | Store internals can drift | Isolate notify logic behind one compatibility adapter |
| Web session atom cast | [src/web/electron-web-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/web/electron-web-plugin.ts:91) | High | Internal atom shape not guaranteed stable | Add runtime guards for atom contract before use |
| Social sign-in callback contract | [src/web/electron-web-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/web/electron-web-plugin.ts:225) | Medium | Option typing/validation may change | Strictly validate callback URL and optional params path |

## 7. Implementation Workstreams (Decision Complete)

### Workstream A: Server Compatibility Hardening
Target file:
- [src/server/electron-server-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/server/electron-server-plugin.ts)

Planned changes:
1. Add compatibility guard helpers for context access.
- Guard and centralize reads to:
- `ctx.context.internalAdapter`
- `ctx.context.authCookies.sessionToken`
- `ctx.context.responseHeaders`
- If missing, throw deterministic `APIError`/`BigIOError` with stable error metadata.

2. Refactor cookie extraction flow to one utility path.
- Handle multiple `Set-Cookie` values consistently.
- Normalize decoding once.
- Keep current security constraints:
- `httpOnly: true`
- `sameSite: 'none'`
- `secure: true`
- strict origin checks.

3. Harden session token lookup.
- Avoid single fragile regex-only path.
- Add fallback parsing for cookie key resolution.
- Emit explicit error reason when token not found.

4. Preserve OAuth callback invariants.
- Keep strict checks for `scheme`, `provider`, and `challenge`.
- Keep mismatch behavior as hard failure.

### Workstream B: Renderer and Web Client Compatibility Layer
Target files:
- [src/renderer/electron-renderer-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/renderer/electron-renderer-plugin.ts)
- [src/web/electron-web-plugin.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/web/electron-web-plugin.ts)

Planned changes:
1. Encapsulate store internals behind local adapters.
- Wrap `$store.notify('$sessionSignal')` so internal signal name dependency exists in one place.
- Wrap session atom access and shape checks in a typed helper.

2. Validate `signIn.social` integration path.
- Keep existing callback URL generation strategy.
- Validate optional search param serialization and decoding behavior under v1.5 types.

3. Keep public plugin actions unchanged.
- Preserve `bigio` namespace methods and hook behavior.
- Preserve deep-link event handling contract and callback semantics.

### Workstream C: Type and Package Compatibility Matrix
Target files:
- [package.json](/Volumes/BiGROG/open-source/better-auth-electron/package.json)
- [src/options/electron-plugin-options.ts](/Volumes/BiGROG/open-source/better-auth-electron/src/options/electron-plugin-options.ts)

Planned changes:
1. Validate type compatibility against both `1.4.18` and `1.5.3`.
- No API break for consumers.
- Keep peer dependency strategy broad unless proven unsafe.

2. Ensure option/type exports remain stable.
- Avoid leaking Better Auth internal types in unstable ways.
- Keep exported option contracts backward compatible.

### Workstream D: Documentation and Positioning
Target files:
- [README.md](/Volumes/BiGROG/open-source/better-auth-electron/README.md)
- [CHANGELOG.md](/Volumes/BiGROG/open-source/better-auth-electron/CHANGELOG.md)

Planned changes:
1. Add compatibility statement.
- "Validated with Better Auth 1.4.18 and 1.5.3".

2. Keep positioning explicit.
- Personal plugin.
- Not official.
- No commitment to parity with official Electron package.

## 8. Detailed Verification Matrix

### Compile and Build Gates
1. Run `pnpm typecheck` with Better Auth `1.4.18`.
2. Run `pnpm typecheck` with Better Auth `1.5.3`.
3. Run `pnpm build` in both matrices.

Expected result:
- Zero type errors in plugin source.
- No missing import/type symbol failures.

### Runtime Flow Gates
1. OAuth happy path.
- Start from web handoff.
- Complete provider auth.
- Intercept callback in server plugin.
- Exchange ticket in renderer.
- Hydrate session successfully.

2. OAuth error path.
- Force provider/callback error.
- Ensure renderer callback reports via `onDeepLinkFailed`.

3. New-user callback path.
- Validate `newUser` status wiring and behavior continuity.

4. Fast ticket path.
- Existing web session should generate fast ticket and deep-link back.

Expected result:
- Status transitions and callbacks remain functionally identical to current behavior.

### Security and Cookie Gates
1. Origin mismatch is rejected at exchange endpoint.
2. PKCE mismatch is rejected deterministically.
3. Tampered ticket is rejected.
4. Multi-cookie response still yields valid session token extraction.
5. Encoded cookie values do not break extraction or cause double-decoding issues.

Expected result:
- Security checks remain strict and no compatibility workaround weakens trust boundaries.

## 9. Acceptance Criteria
1. Plugin compiles and builds with Better Auth `1.5.3`.
2. Plugin still compiles and builds with Better Auth `1.4.18`.
3. No regression in OAuth handoff behavior across server/web/renderer.
4. Cookie interception and session token extraction are stable under v1.5.2+ behavior.
5. Public plugin API remains backward compatible.
6. README/CHANGELOG reflect support matrix and personal-plugin scope.

## 10. Rollout and Rollback
Rollout:
1. Release a compatibility-focused patch/minor version after matrix passes.
2. Announce exact tested Better Auth versions.
3. Mark unsupported assumptions explicitly.

Rollback:
1. Keep previous known-good package tag available.
2. If runtime regressions appear, republish previous tag or hotfix quickly.
3. Maintain a short issue checklist for reproducible failures.

## 11. Execution Order
1. Implement Workstream A (highest risk).
2. Implement Workstream B.
3. Run Workstream C matrix validation.
4. Apply Workstream D docs updates.
5. Run full verification matrix.
6. Release.

## 12. Assumptions and Defaults
- This repository remains a personal custom plugin project.
- Official `@better-auth/electron` package is out of scope for implementation decisions.
- Better Auth `v1.5.3` is treated as latest `v1.5.x` target on March 4, 2026.
- Existing OAuth architecture (IPC + deep link + encrypted ticket) remains unchanged.

## 13. Sources
- Better Auth changelog: [https://better-auth.com/changelog](https://better-auth.com/changelog)
- Better Auth 1.5 release post: [https://better-auth.com/blog/1-5](https://better-auth.com/blog/1-5)
- Better Auth GitHub releases: [https://github.com/better-auth/better-auth/releases](https://github.com/better-auth/better-auth/releases)
