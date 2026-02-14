## [1.0.5] - 2026-02-14

### Refactored

- **Client API Integration**: Redesigned the renderer integration to mimic the official Better Auth API structure under the `bigio` namespace.
- **Deep Link Handling**: Shifted from URL redirect logic to an event subscription model. Added `onDeepLinkSuccess`, `onDeepLinkNewUser`, and `onDeepLinkFailed` listeners.
- **Cold Start Mechanism**: Added an internal buffer to handle deep links triggering before the UI is fully mounted, ensuring no authentication events are lost during startup.

### Documentation

- Updated usage examples to reflect the new `signInSocial` parameter structure (forcing `disableRedirect: false`) and URL-encoded JSON for `additionalData`.

## [1.0.4] - 2026-02-09

### Added

- **Silent Handoff (Server)**: Implemented server-side cookie stripping in `electron-server-plugin` to enforce strict session isolation between browser and Electron.
- **Reactive OAuth State**: Introduced a robust state machine (`idle` -> `pending` -> `connected`) in the React hook to manage authentication flows.
- **Smart Session Detection**: Added logic to detect existing browser sessions ('pending' state) and allow users to "Fast Login" or "Switch Account".

## [1.0.3] - 2026-02-08

### Security

- **Automated CSP Injection**: Implemented `onHeadersReceived` interceptor to inject Content Security Policy headers directly from the Main Process.
- **Dynamic Configuration**: Added auto-whitelisting for `BETTER_AUTH_BASEURL` in `connect-src` and `img-src`.
- **OAuth Image Support**: Updated CSP to allow `https:` schemes in `img-src` specifically for third-party avatar rendering (GitHub/Google).
