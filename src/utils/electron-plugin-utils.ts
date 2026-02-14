// root/packages/better-auth-electron/src/utils/electron-plugin-utils.ts

import { decodeBase64urlIgnorePadding, encodeBase64urlNoPadding } from '@oslojs/encoding'
// import type { AuthClient, BetterAuthClientOptions } from 'better-auth/client'
import type { IpcRenderer, WebFrame, WebUtils } from 'electron'

// import { atom } from 'jotai/vanilla'

import z, { boolean } from 'zod'

import { IS_DEV } from './electron-plugin-env'

// import { BigIOError } from './electron-plugin-env'
// import { okOr, safeTry } from './electron-plugin-helper'
// root/packages/better-auth-electron/src/utils/electron-plugin-helper.ts

// import { BigIOError, consoleError } from './electron-plugin-utils'
type Prettify<T> = {
    [K in keyof T]: T[K]
} & {}
type NonNull<T> = Exclude<T, null | undefined>
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
type BigIOLogger = {
    info(message: unknown, ...args: unknown[]): void
    warn(message: unknown, ...args: unknown[]): void
    error(message: unknown, ...args: unknown[]): void
    debug?(message: unknown, ...args: unknown[]): void
}

export const bigIOLogger: BigIOLogger = {
    info: (message: unknown, ...args: unknown[]) => {
        console.log(message, ...args)
    },
    warn: (message: unknown, ...args: unknown[]) => {
        console.warn(message, ...args)
    },
    error: (message: unknown, ...args: unknown[]) => {
        console.error(message, ...args)
    },
    debug: (message: unknown, ...args: unknown[]) => {
        console.debug(message, ...args)
    },
}
function getPreviousBigIOErrorStack(error: unknown): unknown[] {
    if (error instanceof BigIOError) {
        return error.bigioErrorStack
    }

    if (error instanceof Error && 'bigioErrorStack' in error) {
        return Array.isArray(error.bigioErrorStack) ? error.bigioErrorStack : []
    }
    return []
}
type ErrorMessage = { msg?: string; ctx: unknown } | string | Error | boolean

// biome-ignore lint/style/useUnifiedTypeSignatures: <>
export function okOr<T>(value: T): NonNull<T>
export function okOr<T>(value: T, errorMessage: string): NonNull<T>
export function okOr<T>(value: T, errorMessage: { msg?: string; ctx: unknown }): NonNull<T>
export function okOr<T>(value: T, errorMessage: Error): NonNull<T>
export function okOr<T>(value: T, errorMessage: boolean): NonNull<T>
export function okOr<T>(value: T, errorMessage: ErrorMessage): NonNull<T>
export function okOr<T>(value: T, errorMessage?: ErrorMessage): NonNull<T> {
    // Happy Path
    if (value !== null && value !== undefined) {
        return value as NonNull<T>
    }
    const now = Date.now()

    const ctx = (() => {
        const DEFAULT_CTX = 'okOr function failed'

        if (
            !(errorMessage instanceof Error) &&
            typeof errorMessage === 'object' &&
            'ctx' in errorMessage
        ) {
            return errorMessage.ctx
        }
        if (typeof errorMessage === 'string') {
            return DEFAULT_CTX
        }
        if (errorMessage === undefined) {
            return DEFAULT_CTX
        }
        if (errorMessage instanceof Error) {
            return DEFAULT_CTX
        }
        if (errorMessage === true) {
            return DEFAULT_CTX
        }
        return DEFAULT_CTX
    })()
    const msg = (() => {
        const DEFAULT_MSG = 'Unexpected return null or undefined value'
        if (
            !(errorMessage instanceof Error) &&
            typeof errorMessage === 'object' &&
            'msg' in errorMessage &&
            typeof errorMessage.msg === 'string'
        ) {
            return errorMessage.msg
        }
        if (typeof errorMessage === 'string') {
            return errorMessage
        }
        if (errorMessage === undefined) {
            return DEFAULT_MSG
        }
        if (errorMessage instanceof Error) {
            return DEFAULT_MSG
        }
        if (errorMessage === true) {
            return DEFAULT_MSG
        }
        return DEFAULT_MSG
    })()

    const newItem = {
        msg: msg,
        ctx: ctx,
        timestamp: now,
    }

    if (errorMessage instanceof Error) {
        const prevStack = getPreviousBigIOErrorStack(errorMessage)
        const newStack = [...prevStack, newItem]
        if (!errorMessage.cause) {
            try {
                Object.defineProperty(errorMessage, 'cause', {
                    value: new BigIOError(msg, {
                        bigioErrorStack: newStack,
                    }),
                    configurable: true,
                    writable: true,
                    enumerable: false,
                })
            } catch {
                // some
            }
        }
        try {
            Object.defineProperty(errorMessage, 'bigioErrorStack', {
                value: newStack,
                configurable: true,
                writable: true,
                enumerable: false,
            })
        } catch {
            throw new BigIOError('Wrapper for frozen user error', {
                cause: errorMessage,
                bigioErrorStack: newStack,
            })
        }
        throw errorMessage
    }

    throw new BigIOError(msg, {
        bigioErrorStack: [newItem],
    })
}

const handleUnsafeError = (originalError: unknown, errorMessage?: ErrorMessage) => {
    const now = Date.now()
    const prevStack = getPreviousBigIOErrorStack(originalError)
    const originalErrorMsg =
        originalError instanceof Error ? originalError.message : String(originalError)
    const newMsg = (() => {
        if (errorMessage === true) {
            return originalErrorMsg
        }
        if (typeof errorMessage === 'string') {
            return errorMessage
        }
        if (
            typeof errorMessage === 'object' &&
            'ctx' in errorMessage &&
            !(errorMessage instanceof Error)
        ) {
            return errorMessage.msg || originalErrorMsg
        }
        if (errorMessage instanceof Error) {
            return errorMessage.message
        }
        return originalErrorMsg
    })()
    const userStack = (() => {
        if (errorMessage === true) {
            return [
                {
                    msg: 'SafeTry failed',
                    ctx: originalErrorMsg,
                    timestamp: now,
                },
            ]
        }
        if (typeof errorMessage === 'string') {
            return [
                {
                    msg: errorMessage,
                    ctx: originalErrorMsg,
                    timestamp: now,
                },
            ]
        }
        if (
            typeof errorMessage === 'object' &&
            'ctx' in errorMessage &&
            !(errorMessage instanceof Error)
        ) {
            return [
                {
                    msg: errorMessage.msg || originalErrorMsg,
                    ctx: errorMessage.ctx,
                    timestamp: now,
                },
            ]
        }
        if (errorMessage instanceof Error) {
            const userNewStack = getPreviousBigIOErrorStack(errorMessage)
            if (userNewStack.length > 0) {
                const lastItem = userNewStack.at(-1)
                if (
                    lastItem &&
                    typeof lastItem === 'object' &&
                    !('timestamp' in lastItem && lastItem.timestamp)
                ) {
                    return [...userNewStack.slice(0, -1), { ...lastItem, timestamp: now }]
                }
                return userNewStack
            }
            return [{ msg: errorMessage.message, ctx: originalErrorMsg, timestamp: now }]
        }

        return [{ ctx: originalErrorMsg }]
    })()
    const MAX_STACK_SIZE = IS_DEV ? 500 : 50
    const newStack = (() => {
        const stack = [...prevStack, ...userStack]
        if (stack.length > MAX_STACK_SIZE) {
            return [
                {
                    msg: `... Truncated (Stack > ${MAX_STACK_SIZE}) ...`,
                    ctx: null,
                    timestamp: now,
                },
                ...stack.slice(-MAX_STACK_SIZE),
            ]
        }
        return stack
    })()
    consoleError(originalError, newMsg, newStack)
    if (errorMessage instanceof Error) {
        if (!errorMessage.cause && originalError) {
            try {
                Object.defineProperty(errorMessage, 'cause', {
                    value: originalError,
                    configurable: true,
                    writable: true,
                    enumerable: false,
                })
            } catch {
                // some
            }
        }
        try {
            Object.defineProperty(errorMessage, 'bigioErrorStack', {
                value: newStack,
                configurable: true,
                writable: true,
                enumerable: false,
            })
        } catch {
            throw new BigIOError('Wrapper for frozen user error', {
                cause: errorMessage,
                bigioErrorStack: newStack,
            })
        }
        throw errorMessage
    }
    throw new BigIOError(newMsg, {
        cause: originalError,
        bigioErrorStack: newStack,
    })
}

const handleSafeError = (originalError: unknown) => {
    const prevStack = getPreviousBigIOErrorStack(originalError)
    const originalErrorMsg =
        originalError instanceof Error ? originalError.message : String(originalError)
    const now = Date.now()
    const newStack = [
        ...prevStack,
        { msg: originalErrorMsg, ctx: originalErrorMsg, timestamp: now },
    ]
    return {
        data: null,
        error: new BigIOError(originalErrorMsg, {
            cause: originalError,
            bigioErrorStack: newStack,
        }),
    }
}

const handlePromise = <T>(internalPromise: Promise<T>, errorMessage?: ErrorMessage) => {
    if (errorMessage !== undefined) {
        return internalPromise
            .then((data) => okOr(data, errorMessage))
            .catch((originalError) => handleUnsafeError(originalError, errorMessage))
    }

    return internalPromise
        .then((data) => ({ data: okOr(data), error: null }))
        .catch((originalError) => handleSafeError(originalError))
}

type SafeResult<T> =
    | {
          data: NonNull<T>
          error: null
      }
    | {
          data: null
          error: Error
      }
// biome-ignore lint/style/useUnifiedTypeSignatures: temp
export function safeTry<T>(func: Promise<T>): Promise<SafeResult<T>>
export function safeTry<T>(func: Promise<T>, errorMessage: ErrorMessage): Promise<NonNull<T>>
export function safeTry<T>(func: () => Promise<T>): Promise<SafeResult<T>>
export function safeTry<T>(func: () => Promise<T>, errorMessage: ErrorMessage): Promise<NonNull<T>>
export function safeTry<T>(func: () => T): SafeResult<T>
export function safeTry<T>(func: () => T, errorMessage: ErrorMessage): NonNull<T>

export function safeTry<T>(
    func: Promise<T> | (() => Promise<T>) | (() => T),
    errorMessage?: ErrorMessage,
): Promise<SafeResult<T>> | Promise<NonNull<T>> | SafeResult<T> | NonNull<T> {
    try {
        if (func instanceof Promise) {
            return handlePromise(func, errorMessage)
        }
        if (typeof func === 'function') {
            const result = func()
            if (result instanceof Promise) {
                return handlePromise(result, errorMessage)
            }

            if (errorMessage !== undefined) {
                return okOr(result, errorMessage)
            }
            return {
                data: okOr(result),
                error: null,
            }
        }
    } catch (error) {
        if (errorMessage !== undefined) {
            handleUnsafeError(error, errorMessage)
        }
        return handleSafeError(error)
    }
    const now = Date.now()
    const invalidInputMsg = 'SayTry Fn Invalid input: expected Function or Promise'
    const invalidError = new BigIOError(invalidInputMsg, {
        cause: func,
        bigioErrorStack: [
            {
                msg: invalidInputMsg,
                ctx: 'Type Check Failed',
                timestamp: now,
            },
        ],
    })
    if (errorMessage !== undefined) {
        throw invalidError
    }
    return {
        data: null,
        error: invalidError,
    }
}

const crypto = globalThis.crypto
const ALGO_SHA = 'SHA-256'
const HKDF_ALGO = { name: 'HKDF' }
const AES_ALGO = { name: 'AES-GCM', length: 128 }
const secretKeyCache = new Map<string, CryptoKey>()

const MAX_CACHE_SIZE = 50
const GLOBAL_ENCODER = new TextEncoder()
const GLOBAL_DECODER = new TextDecoder()
async function getCachedKey(secret: string): Promise<CryptoKey> {
    const checkSecret = okOr(secret, {
        msg: 'Invalid secret input for getCachedKey',
        ctx: {
            secretLength: secret?.length,
        },
    })
    const keyDataBuffer = await safeTry(
        crypto.subtle.digest(ALGO_SHA, GLOBAL_ENCODER.encode(checkSecret)),
        {
            msg: 'Failed to create SHA digest from secret',
            ctx: { secretLength: checkSecret.length },
        },
    )

    const cacheKeyIndex = encode64(keyDataBuffer)
    if (secretKeyCache.has(cacheKeyIndex)) {
        const cachedKey = secretKeyCache.get(cacheKeyIndex)
        if (cachedKey) {
            secretKeyCache.delete(cacheKeyIndex)
            secretKeyCache.set(cacheKeyIndex, cachedKey)
            return cachedKey
        }
    }
    const keyMaterial = await safeTry(
        crypto.subtle.importKey('raw', GLOBAL_ENCODER.encode(checkSecret), HKDF_ALGO, false, [
            'deriveKey',
        ]),
        {
            msg: 'Failed to import raw key material',
            ctx: {
                algo: HKDF_ALGO.name,
            },
        },
    )
    const key = await safeTry(
        crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: ALGO_SHA,
                salt: new Uint8Array(),
                info: GLOBAL_ENCODER.encode('better-auth-electron-v1'),
            },
            keyMaterial,
            AES_ALGO,
            false,
            ['encrypt', 'decrypt'],
        ),
        {
            msg: 'HKDF deriveKey failed',
            ctx: {
                algo: HKDF_ALGO.name,
            },
        },
    )
    if (secretKeyCache.size >= MAX_CACHE_SIZE) {
        const staleKey = secretKeyCache.keys().next().value
        if (staleKey) {
            secretKeyCache.delete(staleKey)
        }
    }
    secretKeyCache.set(cacheKeyIndex, key)
    return key
}

function encode64(buffer: Uint8Array | ArrayBuffer) {
    const checkBuffer = okOr(buffer, {
        msg: 'Invalid buffer input for toBase64Url',
        ctx: { type: typeof buffer },
    })
    const bytes = checkBuffer instanceof Uint8Array ? checkBuffer : new Uint8Array(checkBuffer)

    return encodeBase64urlNoPadding(bytes)
}

function decode64(str: string): Uint8Array {
    const checkStr = okOr(str, {
        msg: 'Invalid string input for fromBase64Url',
        ctx: {
            stringLength: str?.length,
        },
    })

    const normalizedStr = checkStr.replace(/\+/g, '-').replace(/\//g, '_')
    const bytesBuffer = safeTry(() => decodeBase64urlIgnorePadding(normalizedStr), {
        msg: 'Base64 Decoding Failed',
        ctx: {
            msg: 'Oslo decode failed',
            ctx: { strPart: str.slice(0, 10) },
        },
    })

    return bytesBuffer as unknown as Uint8Array
}

export async function encryptTicket(
    payload: Record<string, unknown>,
    secret: string,
    ttlSeconds = 60,
): Promise<string> {
    const checkPayload = okOr(payload, {
        msg: 'Invalid payload: input is null or undefined for encryptTicket',
        ctx: {
            keys: payload ? Object.keys(payload) : null,
        },
    })
    const checkSecret = okOr(secret, {
        msg: 'Invalid secret: input is empty or invalid for encryptTicket',
        ctx: { secretLength: secret?.length },
    })
    const key = await safeTry(getCachedKey(checkSecret), {
        msg: 'Key initialization failed: unable to derive crypto key from secret',
        ctx: { secretLength: secret.length },
    })
    const iv = okOr(crypto.getRandomValues(new Uint8Array(12)), {
        msg: 'Crypto failure: system RNG failed to generate Initialization Vector (IV)',
        ctx: { requiredBytes: 12 },
    })
    const finalPayload = {
        payload: checkPayload,
        exp: Date.now() + ttlSeconds * 1000,
    }
    const jsonString = safeTry(() => JSON.stringify(finalPayload), {
        msg: 'Serialization failed: payload contains unserializable data (e.g., BigInt, Circular ref)',
        ctx: {
            payloadKeys: Object.keys(checkPayload),
            exp: finalPayload.exp,
        },
    })

    const encodedData = GLOBAL_ENCODER.encode(jsonString)
    const encryptedContent = await safeTry(
        crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, encodedData),
        {
            msg: 'Encryption failed: AES-GCM encryption process encountered an error',
            ctx: {
                ivLength: iv.byteLength,
                dataLength: encodedData.byteLength,
                algo: 'AES-GCM',
            },
        },
    )
    const returnIV = encode64(iv)
    const returnData = encode64(encryptedContent)

    return `${returnIV}.${returnData}`
}

export async function decryptTicket<T = Record<string, unknown>>(
    ticket: string,
    secret: string,
): Promise<T> {
    const checkTicket = okOr(ticket, {
        msg: 'Ticket Validation for decryptTicket Failed: Input is null or undefined',
        ctx: {
            length: ticket?.length,
        },
    })
    const checkSecret = okOr(secret, {
        msg: 'Secret Validation for decryptTicket Failed: Input is null or undefined',
        ctx: {
            length: secret?.length,
        },
    })
    const now = Date.now()
    if (!checkTicket.includes('.')) {
        throw new BigIOError('Ticket Malformed: Missing separator (.)', {
            bigioErrorStack: [
                {
                    msg: 'Ticket Malformed: Missing separator (.)',
                    ctx: { ticketPart: `${checkTicket.slice(0, 10)}...` },
                    timestamp: now,
                },
            ],
        })
    }
    const [ivUrl, dataUrl] = checkTicket.split('.')
    if (!(ivUrl && dataUrl)) {
        throw new BigIOError('Invalid ticket format: incomplete parts', {
            bigioErrorStack: [
                {
                    msg: 'Invalid ticket format: incomplete parts',
                    ctx: { ticketPart: `${checkTicket.slice(0, 10)}...` },
                    timestamp: now,
                },
            ],
        })
    }
    const iv = decode64(ivUrl)
    const data = decode64(dataUrl)

    if (iv.byteLength !== 12) {
        throw new BigIOError('Crypto Failure: Invalid IV length', {
            bigioErrorStack: [
                {
                    msg: 'AES-GCM requires 12-byte IV',
                    ctx: { actualLength: iv.byteLength, expected: 12 },
                    timestamp: now,
                },
            ],
        })
    }
    const key = await safeTry(getCachedKey(checkSecret), {
        msg: 'Key Derivation Failed: Unable to generate crypto key',
        ctx: { secretLength: checkSecret.length },
    })
    const decryptedBuffer = await safeTry(
        crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as unknown as BufferSource },
            key,
            data as unknown as BufferSource,
        ),
        {
            msg: 'Decryption Failed: Authentication tag mismatch or data corruption',
            ctx: { ivLength: iv.byteLength, dataLength: data.byteLength },
        },
    )
    const decodedString = GLOBAL_DECODER.decode(decryptedBuffer)
    const rawJson = safeTry(() => JSON.parse(decodedString), {
        msg: 'JSON Parsing Decrypted payload Failed',
        ctx: { len: decodedString.length, prefix: decodedString.slice(0, 10) },
    })
    const isValidPayload = safeTry(
        () =>
            z
                .object({
                    payload: z.record(z.string(), z.unknown()).or(z.looseObject({})),
                    exp: z.number().int().min(1),
                })
                .parse(rawJson),
        true,
    )
    const expNow = Date.now()

    if (expNow > isValidPayload.exp) {
        throw new BigIOError('Ticket Expired', {
            bigioErrorStack: [
                {
                    msg: 'Ticket Expired',
                    ctx: {
                        exp: isValidPayload.exp,
                        now: expNow,
                        expiredByMs: expNow - isValidPayload.exp,
                    },
                    timestamp: expNow,
                },
            ],
        })
    }
    return isValidPayload.payload as T
}

export function pkceGenerateVerifier(byteLength = 32): string {
    if (byteLength < 32 || byteLength > 96) {
        throw new BigIOError('PKCE Error: Invalid Verifier Length', {
            bigioErrorStack: [
                {
                    msg: 'Verifier byte length must be between 32 and 96',
                    ctx: {
                        inputLength: byteLength,
                        rfcRequirement: '43-128 chars string',
                    },
                    timestamp: Date.now(),
                },
            ],
        })
    }

    const buffer = new Uint8Array(byteLength)

    const randomValues = okOr(crypto.getRandomValues(buffer), {
        msg: 'PKCE Failure: System RNG failed to generate Verifier entropy',
        ctx: { requiredBytes: byteLength },
    })
    const result = encode64(randomValues)
    return result
}

export async function pkceGenerateChallenge(verifier: string): Promise<string> {
    const checkVerifier = okOr(verifier, {
        msg: 'PKCE Challenge Failure: Verifier input is empty or invalid',
        ctx: { length: verifier?.length },
    })
    const data = GLOBAL_ENCODER.encode(checkVerifier)
    const hashBuffer = await safeTry(crypto.subtle.digest(ALGO_SHA, data), {
        msg: `PKCE Challenge Failure: ${ALGO_SHA} digest failed`,
        ctx: {
            verifierBytes: data.byteLength,
            algo: ALGO_SHA,
        },
    })

    return encode64(hashBuffer)
}
const REGEX_BASE64_URL = /^[a-zA-Z0-9\-_]+=*$/

export function RequiredSearchParamsBuilder(ELECTRON_SCHEME: string, PROVIDERS: string[]) {
    return z.object({
        scheme: z
            .string()
            .min(1, 'Scheme cannot be empty')
            .regex(REGEX_BASE64_URL)
            .refine((scheme) => scheme === ELECTRON_SCHEME, {
                message: 'Invalid scheme provided',
            }),
        provider: z.enum(PROVIDERS),
        challenge: z
            .string()
            .length(43, 'Challenge must be exactly 43 characters')
            .regex(REGEX_BASE64_URL),
        status: z.enum(['succeed', 'error', 'newUser']).optional(),
    })
}
export const OptionalSearchParamsZodBuilder = z.object({
    scopes: z.array(z.string()).optional(),
    loginHint: z.string().optional(),
    additionalData: z.record(z.string(), z.any()).optional(),
    requestSignUp: boolean().optional(),
})
export const safeEncodeURL = (data: unknown) => {
    return safeTry(() => {
        if (data === undefined || data === null) {
            throw new BigIOError('Invalid input for safeEncodeURL: input is null/undefine', {
                bigioErrorStack: [{ msg: 'input is null/undefine' }],
            })
        }

        const jsonStr = JSON.stringify(data)
        const bytes = GLOBAL_ENCODER.encode(jsonStr)

        return encode64(bytes)
    }, true)
}

export const safeDecodeURL = <T = unknown>(data: string): T => {
    return safeTry(() => {
        if (data === undefined || data === null) {
            throw new BigIOError('Invalid input for safeDecodeURL: input is null/undefined', {
                bigioErrorStack: [{ msg: 'input is null/undefined' }],
            })
        }
        if (typeof data !== 'string') {
            throw new BigIOError('Invalid input for safeDecodeURL: expected string', {
                bigioErrorStack: [{ ctx: { type: typeof data, value: data } }],
            })
        }
        const bytes = decode64(data)
        const jsonStr = GLOBAL_DECODER.decode(bytes)
        return JSON.parse(jsonStr)
    }, true)
}
