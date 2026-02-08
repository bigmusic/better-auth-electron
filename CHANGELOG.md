### Features

Here is the professional way to log this. It highlights the **Developer Experience (DX)** improvement.

## [1.0.3] - 2026-02-08

### Features

- **Automated Security Policy (CSP)**:
  - Implemented `onHeadersReceived` interceptor to inject CSP headers directly from the Main Process.
  - **Zero-Config Experience**: Users no longer need to manually maintain complex `<meta>` tags in `index.html`.
  - **Dynamic Configuration**: Automatically whitelists the `BETTER_AUTH_BASEURL` for `connect-src` and `img-src`.
  - **OAuth Support**: `img-src` now defaults to allowing `https:` schemes to support dynamic avatar URLs from third-party providers (GitHub, Google, etc.).
