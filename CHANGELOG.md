### Features

Here is the professional way to log this. It highlights the **Developer Experience (DX)** improvement.

## [1.0.3] - 2026-02-08

### Features

- **Automated Security Policy (CSP)**:
  - Implemented `onHeadersReceived` interceptor to inject CSP headers directly from the Main Process.
  - **Zero-Config Experience**: Users no longer need to manually maintain complex `<meta>` tags in `index.html`.
  - **Dynamic Configuration**: Automatically whitelists the `BETTER_AUTH_BASEURL` for `connect-src` and `img-src`.
  - **OAuth Support**: `img-src` now defaults to allowing `https:` schemes to support dynamic avatar URLs from third-party providers (GitHub, Google, etc.).

## [1.0.4] - 2026-02-09

### Features

- **Silent Handoff Architecture (Server-Side)**:
- **Cookie Stripping**: The `electron-server-plugin` now actively intercepts OAuth callback responses and removes the `Set-Cookie` header.
- **Session Isolation**: Ensures strict physical isolation between the browser's web session and the Electron session. The browser now acts solely as a stateless transport layer for the encrypted authentication ticket.

- **Reactive OAuth Client (Web-Side)**:
- **Enhanced `useElectronOAuthSession` Hook**: Introduced a robust state machine (`idle` | `pending` | `connecting` | `succeed` | `failed`).
- **Session Detection ('pending' state)**: The hook now intelligently detects existing browser sessions and pauses the flow, allowing the UI to prompt the user for a "Fast Login" (reuse session) or "Switch Account" (fresh login).
- **Action Trigger**: Exposed `setFastLogin(boolean)` to programmatically control the authentication flow and update the reactive state.
