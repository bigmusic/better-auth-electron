// utils/electron-plugin-env.ts
/** biome-ignore-all lint/style/useConsistentTypeDefinitions: <> */
import type { IpcRenderer, WebFrame, WebUtils } from 'electron'

type Prettify<T> = {
    [K in keyof T]: T[K]
} & {}
declare const process:
    | {
          env: {
              NODE_ENV?: string
          }
          versions?: {
              electron?: string
          }
      }
    | undefined

declare global {
    interface ImportMetaEnv {
        readonly MODE: string
        readonly DEV: boolean
        readonly PROD: boolean
        readonly SSR: boolean

        [key: string]: unknown
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv
    }
}

declare global {
    interface Window {
        electron: {
            webUtils: Prettify<WebUtils>
            webFrame: Prettify<WebFrame>
            process: Prettify<SafeProcess>
            ipcRenderer: Prettify<IpcRenderer>
        }
    }
}
type SafeProcess = {
    readonly platform: NodeJS.Platform
    readonly versions: NodeJS.ProcessVersions
    readonly env: NodeJS.ProcessEnv
}

type ElectronWindow = Window & {
    electron: {
        webUtils: Prettify<WebUtils>
        webFrame: Prettify<WebFrame>
        process: Prettify<SafeProcess>
        ipcRenderer: Prettify<IpcRenderer>
    }
}
const getGlobal = () => {
    if (typeof globalThis !== 'undefined') {
        return globalThis
    }
    if (typeof self !== 'undefined') {
        return self
    }
    if (typeof window !== 'undefined') {
        return window
    }
    if (typeof global !== 'undefined') {
        return global
    }
    throw new Error('unable to locate global object')
}
const globals = getGlobal()
// function requireSetCookies(headers: Headers) {
//     if (typeof headers.getSetCookie !== 'function') {
//         throw new BigIOError('Environment Error: headers.getSetCookie is not a function.', {
//             bigioErrorStack: [
//                 {
//                     msg: 'Outdated Node.js Environment',
//                     ctx: `'Please upgrade NodeJS to 18.14+`,
//                 },
//             ],
//         })
//     }

//     const setCookieHeader = headers.getSetCookie()
//     if (!setCookieHeader || setCookieHeader.length === 0) {
//         const headerKeys = Array.from(headers.keys()).join(', ')
//         throw new APIError('INTERNAL_SERVER_ERROR', {
//             message: 'Critical: No Set-Cookie headers received from provider',
//             debugInfo: { availableHeaders: headerKeys },
//         })
//     }
//     return setCookieHeader
// }
export function isElectronWindow(window: Window | typeof globalThis): window is ElectronWindow {
    if (typeof window !== 'undefined') {
        if (
            typeof navigator !== 'undefined' &&
            'userAgent' in navigator &&
            navigator.userAgent.toLowerCase().includes(' electron/')
        ) {
            return true
        }
        if ('electron' in window && typeof window.electron !== 'undefined') {
            return true
        }
    }
    return false
}
const getEnv = () => {
    if (typeof window !== 'undefined') {
        if (isElectronWindow(globals)) {
            return 'ELECTRON_RENDERER'
        }
        return 'BROWSER'
    }
    if (globalThis === self) {
        return 'WORKER'
    }
    if (typeof global !== 'undefined' && typeof process !== 'undefined') {
        if (typeof process.versions?.electron !== 'undefined') {
            return 'ELECTRON_MAIN'
        }
        return 'NODE'
    }
    return 'UNKNOWN'
}
const getRawNodeEnv = (): string => {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.MODE) {
        return import.meta.env.MODE
    }

    // biome-ignore lint/complexity/useOptionalChain: <>
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) {
        return process.env.NODE_ENV
    }

    return 'development'
}

const RAW_ENV = getRawNodeEnv()

export const IS_DEV = RAW_ENV === 'development'
export const IS_PROD = RAW_ENV === 'production'
export const IS_TEST = RAW_ENV === 'test'

export const IS_ELECTRON_PACKAGED = (() => {
    // biome-ignore lint/complexity/useOptionalChain: <>
    if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
        try {
            return require('electron').app.isPackaged
        } catch {
            return false
        }
    }
    return false
})()

if (typeof console !== 'undefined') {
    console.debug(`[ENV] Current Mode: ${RAW_ENV} | Packaged: ${IS_ELECTRON_PACKAGED}`)
}
