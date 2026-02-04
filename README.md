# @bigio/better-auth-electron

> **Work In Progress:** This library is actively being developed. Detailed documentation and architecture diagrams are coming soon.

**A type-safe, IPC-Event based Better Auth integration for Electron.**

Designed for production-grade applications, this library provides a secure, "batteries-included" solution to integrate [Better Auth](https://www.better-auth.com) into Electron apps without the headache of writing manual IPC bridges or handling complex OAuth window flows.

## ✨ Features

- ** Native Secure Context & Origin Fix:**
  Leverages `protocol.registerSchemesAsPrivileged` to treat your custom scheme as a secure context. This solves the infamous `Origin` header mismatch and enables `SameSite` cookies to work natively without hacks.

- ** Secure PKCE Flow:**
  Implements the standard **Proof Key for Code Exchange** protocol out-of-the-box. Ensures enterprise-grade security for your OAuth exchanges without exposing secrets.

- ** Preact SSR Ready:**
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
  // Use the classic 'onBeforeRequest' filter approach for auth code capture if true
  OLD_SCHOOL_ONBEFORE_WAY: false,
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

### 4. Electron Renderer / Login Page (`src/renderer/pages/login.tsx`)

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

### 5. Electron Renderer/Web Client (`src/renderer/lib/auth-client.ts`)

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

### 6. Web/App Component Usage (`src/web/components/user-session.tsx`)

The `useElectronOAuthSession` hook is the heart of the "Handoff" experience. It listens for the deep link callback and automatically verifies the session.

```typescript
import { authClient } from '@/web/client'

export function UserSessionStatus() {
  const {
    data: useSessionData,
    error,
    isPending,
    isRefetching,
    refetch,
    // // The current status of the handoff process on the client side
    // (e.g., 'idle' | 'succeed' | 'failed')
    oauthMessage
  } = authClient.bigio.useElectronOAuthSession()

  if (isPending) return <div>Loading session... {oauthMessage}</div>
  if (error) return <div>Error: {error.message}</div>

  return (
    <div>
      <h1>Welcome, {useSessionData?.user.name}</h1>
      <p>Status: {oauthMessage || 'Idle'}</p>
    </div>
  )
}
```

## License

MIT © [bigmusic](https://github.com/bigmusic/better-auth-electron)
