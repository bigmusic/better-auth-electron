// utils/env.ts
/** biome-ignore-all lint/style/useConsistentTypeDefinitions: <> */

export class BigIOError extends Error {
    public readonly bigioErrorStack: unknown[]

    constructor(message: string, options: { cause?: unknown; bigioErrorStack?: unknown[] }) {
        super(message, { cause: options.cause })
        this.name = 'BigIOError'
        this.bigioErrorStack = options.bigioErrorStack || []

        Object.setPrototypeOf(this, new.target.prototype)
        Object.defineProperty(this, 'bigioErrorStack', { enumerable: false })
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor)
        }
    }
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            stack: this.stack,
            cause: this.cause,
            bigioErrorStack: this.bigioErrorStack,
        }
    }
}
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

export const consoleError = (
    originalError: unknown,
    message?: string,
    bigioErrorStack?: unknown[],
) => {
    if (!IS_DEV) {
        return
    }
    if (message && bigioErrorStack) {
        console.groupCollapsed(`[BigIOError]`)
        console.error('[BigIOError] message: ', message)
        if (Array.isArray(bigioErrorStack) && bigioErrorStack.length > 0) {
            console.log('[BigIOError] Stack Trace Table: ')
            console.table(bigioErrorStack)
        }
        console.error('[BigIOError] Original Error: ', originalError)
        console.groupEnd()
    } else if (originalError instanceof BigIOError) {
        console.groupCollapsed(`[BigIOError]`)
        console.error('[BigIOError] message: ', originalError.message)
        if (
            Array.isArray(originalError.bigioErrorStack) &&
            originalError.bigioErrorStack.length > 0
        ) {
            console.log('[BigIOError] Stack Trace Table: ')
            console.table(originalError.bigioErrorStack)
        }
        console.error('[BigIOError] Original Error: ', originalError.cause)
        console.groupEnd()
    } else {
        console.groupCollapsed(`[Error]`)
        console.error('[Error]: ', originalError)
        console.groupEnd()
    }
}
export const consoleLog = (...argv: unknown[]): void => {
    if (IS_DEV) {
        console.log(...argv)
    }
}

export const IS_ELECTRON_PACKAGED = (() => {
    // biome-ignore lint/complexity/useOptionalChain: <>
    if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
        try {
            const { app } = require('electron')
            return app.isPackaged
        } catch {
            return false
        }
    }
    return false
})()

if (typeof console !== 'undefined') {
    console.debug(`[ENV] Current Mode: ${RAW_ENV} | Packaged: ${IS_ELECTRON_PACKAGED}`)
}
