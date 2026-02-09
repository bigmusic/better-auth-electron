## I'm currently studying the official implementation; the documentation is still rough but will be improved soon. I'm eager and looking forward to exchanging ideas with everyone.

Based on my study of the official implementation code, I have decided on the following to-do list:

**~~1. Architecture: The "Silent Handoff" (Stateless & Secure)~~**

- [done] ~~**Server-Side Cookie Interception**: Modify `electron-server-plugin` to intercept the OAuth callback response.~~
- ~~_Action_: Strip the `Set-Cookie` header (specifically the session token) from the response to prevent overwriting the user's browser session.~~
- ~~_Goal_: Achieve strict physical isolation between Web Session and Electron Session.~~

- ~~**Stateless OAuth Flow**: Ensure the OAuth flow relies solely on the encrypted `Ticket` mechanism, making the browser a purely stateless transport layer for Electron authentication.~~

**2. Security & Hardening**

- [ ] **Secure Persistence**: Implement `safeStorage` (DPAPI/Keychain) for encrypting the persisted PKCE Verifier on disk.
- _Reason_: Prevent plaintext credentials from resting on the file system.

- [ ] **User-Agent Scrubbing**: Global removal of "Electron" tokens from the `User-Agent` string at the `app.on('ready')` stage.
- _Reason_: Bypass WAF/Anti-Bot protections that block Electron-based requests during the ticket exchange phase.

- [done] ~~**Automated CSP Injection**: Implement `onHeadersReceived` interceptor in the Main Process.~~
  - ~~_Action_: Automatically append the backend API URL to the `connect-src` directive.~~
  - ~~_Goal_: Provide a "Zero-Config" experience by preventing CSP violations without requiring users to manually edit `index.html`.~~

**3. Developer Experience (DX) & API**

- [ ] **Enhanced Renderer API**: Refactor `getActions` to introduce a dedicated `authClient.bigio` namespace.
- _Feature_: Implement `authClient.bigio.signIn({ provider: 'github' })` wrapper.
- _Implementation_: Utilize `window.open` (intercepted by Main) or IPC to trigger the flow, keeping the API consistent with the official web client style.

- [done] ~~**Smart Web Handoff UI (Optional/Next)**: Update the web-side confirmation page to detect and display the currently logged-in web user, offering a "Continue as [User]" button for a seamless transition.~~

# @bigio/better-auth-electron

> **Work In Progress:** This library is actively being developed. Detailed documentation and architecture diagrams are coming soon.

**A type-safe, IPC-Event based Better Auth integration for Electron.**

Designed for production-grade applications, this library provides a secure, "batteries-included" solution to integrate [Better Auth](https://www.better-auth.com) into Electron apps without the headache of writing manual IPC bridges or handling complex OAuth window flows.

## Features

- ** Native Secure Context & Origin Fix:**
  Leverages `protocol.registerSchemesAsPrivileged` to treat your custom scheme as a secure context. This solves the infamous `Origin` header mismatch and enables `SameSite` cookies to work natively without hacks.

- ** Secure PKCE Flow:**
  Implements the standard **Proof Key for Code Exchange** protocol out-of-the-box. Ensures enterprise-grade security for your OAuth exchanges without exposing secrets.

- ** Preact SSR Coming soon:**
  Includes a dedicated, lightweight Preact entry point optimized for Server-Side Rendering (SSR) in login windows.
  _(React 19 supported. Vue/Svelte support coming soon!)_

- ** Zero-IPC Session Handoff:**
  Uses secure custom protocol deep links to transfer authentication states. Full TypeScript inference via Better Auth plugins — **no fragile IPC bridges** or manual message handling required.

## Installation

```bash
pnpm add @bigio/better-auth-electron
```

Ensure peer dependencies are installed:(more framework support coming soon...)

```bash
pnpm add better-auth electron react react-dom
```

## Quick Start

### 1. Server Setup (`src/lib/auth.ts`)

Initialize Better Auth with the `electronServerPlugin`. This handles the ticket exchange and verification logic on your backend.

#### The "Silent Handoff" Mechanism (Stateless & Secure)

This plugin implements a **Server-Side Cookie Interception** strategy to ensure strict isolation between the Web Session and the Electron Session.

- It intercepts OAuth callback responses specifically for Electron. It actively **removes the `Set-Cookie` header** (which contains the session token) before the response reaches the browser.
- This guarantees that the Electron login flow **does not overwrite or interfere** with the user's existing browser session.
- Authentication relies solely on a one-time encrypted Ticket. The browser acts as a purely **`stateless`** transport layer for Electron.

```typescript
import { betterAuth } from 'better-auth'
import { electronServerPlugin } from '@bigio/better-auth-electron/server'

export const auth = betterAuth({
  baseURL: 'http://localhost:3002',
  // ... your database configuration
  plugins: [
    electronServerPlugin({
      // The custom scheme your Electron app uses (e.g. bigio://)
      ELECTRON_SCHEME: 'bigio',
      // Allowed providers for Electron OAuth flow
      PROVIDERS: ['github', 'google'],
    }),
  ],
  database: {
    //...
  },
})
```

### 2. Electron Main Process (`src/main/index.ts`)

Use `mainInjection` to setup IPC handlers and deep linking strategies. This automatically handles the "protocol" opening events.

### Security & CSP Configuration

** IMPORTANT: Clean up your `index.html`**

This plugin automatically injects a rigorous, production-ready **Content Security Policy (CSP)** via the Main Process.

**You CAN remove** any manual CSP `<meta>` tags from your `index.html` (renderer). Leaving them in will cause the browser to enforce the "intersection" of both policies, likely breaking your Auth flow (e.g., blocking the OAuth popup or API connection).

**DELETE this from your `index.html`:**

```html
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'self'; 
  script-src 'self'; 
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self' http://localhost;
  " />
```

```typescript
import { app, BrowserWindow } from 'electron'
import { mainInjection } from '@bigio/better-auth-electron/main'

// Initialize the plugin logic
const { windowInjection, whenReadyInjection } = mainInjection({
  isOAuth: true,
  ELECTRON_APP_NAME: 'bigio-electron-demo',
  ELECTRON_SCHEME: 'bigio', // Must match the server config
  PROVIDERS: ['github', 'google'],
  BETTER_AUTH_BASEURL: 'http://localhost:3002',
  FRONTEND_URL: 'http://localhost:3001/oauth',
  /**
   * [Optional] Content Security Policy (CSP) Configuration
   * * Strategy: "All-or-Nothing"
   * - undefined (Default): The plugin automatically injects a secure, production-ready CSP (The "MVP" Fallback).
   * - string: The plugin uses YOUR string exactly. No merging, no magic. You take full control.
   */
  CONTENT_SECURITY_POLICY: "default-src 'self'; ...", // override completely
})

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    /* config */
  })

  // Inject ipcRenderer event into the specific window instance
  windowInjection(mainWindow)
}

app.whenReady().then(() => {
  // Register custom protocol schemes
  whenReadyInjection()
  createWindow()
})
```

**If CONTENT_SECURITY_POLICY is not provided, the plugin applies the following strictly secure rules to the Main Frame (index.html) automatically. This ensures Auth works out-of-the-box while keeping your app secure.**

```http
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
# Allows loading images from 'self', OAuth providers (https:), and your Auth Server
img-src 'self' data: blob: https: ${BETTER_AUTH_BASEURL};
# Strictly restricts API connections to 'self' and your Auth Server
connect-src 'self' ${BETTER_AUTH_BASEURL};
font-src 'self' data:;
# Prevents clickjacking attacks
frame-ancestors 'none';
```

### 3. Web Client Initialization (`src/web/client.ts`)

Configure the client-side plugin. Note the usage of `setLazyClient` to handle circular dependencies or lazy initialization patterns effectively.

```typescript
import { createAuthClient } from 'better-auth/react'
import { electronWebHandoffPlugin, setLazyClient } from '@bigio/better-auth-electron/web'
import type { auth } from '@/lib/auth' // Import type from your server file

export const authClient = createAuthClient({
  baseURL: 'http://localhost:3002',
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [
    // Type-safe plugin initialization
    electronWebHandoffPlugin<typeof auth>(),
  ],
})

// Important: Register the client instance for plugin lazy access, this for soical signin
setLazyClient(authClient)
```

### 4. Electron Renderer/Web Client (`src/renderer/lib/auth-client.ts`)

This is the auth client running **inside your Electron app**. It listens for the custom protocol deep link to hydrate the session.

> **Suggestion:** set `credentials: 'include'` to ensure the session cookie generated by the secure protocol is correctly persisted.

```typescript
import { createAuthClient } from 'better-auth/react'
import { electronRendererPlugin } from '@bigio/better-auth-electron/renderer'

export const authClient = createAuthClient({
  baseURL: 'http://localhost:3002',
  fetchOptions: {
    // It ensures cookies are sent/received correctly in the custom scheme.
    credentials: 'include',
  },
  plugins: [
    electronRendererPlugin({
      ELECTRON_SCHEME: 'bigio', // Must match Main process config
    }),
  ],
})
```

### 5. Electron Renderer / Login Page (`src/renderer/pages/login.tsx`)

In your Electron renderer (the UI), use the helper options to construct the correct OAuth URL that opens in the system's default browser.

```typescript
import type { ElectronButtonOptions } from '@bigio/better-auth-electron/options'
import { defaultButtonOptions } from '@bigio/better-auth-electron/options'

// Merge default options with any custom overrides
const config: ElectronButtonOptions = { ...defaultButtonOptions }
const { FRONTEND_URL, PROVIDER_NAME_IN_URL } = config

const ElectronLoginButton = ({ provider }: { provider: string }) => {
  const handleOpen = () => {
    // Construct the auth URL
    const targetUrl = `${FRONTEND_URL}?${PROVIDER_NAME_IN_URL}=${provider}`

    // Open in external browser (e.g., Chrome/Safari) to start the flow
    window.open(targetUrl, '_blank')
    console.log('Opening External Browser for OAuth...')
  }

  return (
    <button onClick={handleOpen}>
      Sign in with {provider}
    </button>
  )
}
```

### 6. Web/App Component Usage (`src/web/components/user-session.tsx`)

The `useElectronOAuthSession` hook is the core of the "Handoff" experience. It manages the synchronization between the web authentication state and the Electron application.

#### Component Implementation

The hook provides reactive states to manage the UI. Most importantly, the 'pending' state serves as a "Session Detected" signal.

To resolve this state, you use the `setFastLogin` function. Calling this function immediately updates the oauthStatus and triggers the next step in the authentication flow.

```tsx
import { useEffect } from 'react'
import { authClient } from '@/web/client'

export function UserSessionStatus() {
  const {
    data: sessionData,
    error,
    isPending, // Initial loading state

    // Status enum: 'idle' | 'pending' | 'connecting' | 'succeed' | 'failed'
    // 'pending': CRITICAL state. It confirms a valid session ALREADY exists
    // and the system is pausing to wait for the user's decision.
    oauthStatus,
    oauthError,

    // Action to control the flow:
    // setFastLogin(true)  = Fast Login (Use current session)
    // setFastLogin(false) = Switch Account (Ignore current session)
    setFastLogin,
  } = authClient.bigio.useElectronOAuthSession()

  /**
   * Optional: Force Logic (Auto-decision)
   * If you want to skip the user choice UI:
   */
  useEffect(() => {
    setFastLogin(true) // Force Fast Login immediately
    // OR
    setFastLogin(false) // Force Switch Account immediately
  }, [])

  /**
   * Optional: User-decision
   * If you want to let the user choice:
   */
  return (
    <div>
      {/* The 'pending' status indicates a session collision/detection.
        We present the choice to the user here.
      */}
      {oauthStatus === 'pending' ? (
        <>
          {/* Option: Ignore current session and re-login */}
          <button onClick={() => setFastLogin(false)}>Switch Account</button>
          {/* Option: Use current session for Electron */}
          <button onClick={() => setFastLogin(true)}>Fast Login</button>
        </>
      ) : null}
    </div>
  )
}
```

## License

MIT © [bigmusic](https://github.com/bigmusic/better-auth-electron)
