// root/packages/better-auth-electron/src/utils/electron-plugin-helper.ts

import { BigIOError, consoleError, IS_DEV } from './electron-plugin-env'

type NonNull<T> = Exclude<T, null | undefined>

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
