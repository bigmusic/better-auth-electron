// root/src/renderer/electron-renderer-plugin.ts

import type { BetterAuthClientPlugin, Session, User } from 'better-auth'
import { atom } from 'nanostores'
import z from 'zod'
import type { ElectronRendererPluginOptions } from '../options/electron-plugin-options'
import { defaultRendererPluginOptions } from '../options/electron-plugin-options'
import type { electronServerPlugin } from '../server/electron-server-plugin'
import { isElectronWindow } from '../utils/electron-plugin-env'
import {
    BigIOError,
    consoleError,
    consoleLog,
    OptionalSearchParamsZodBuilder,
    pkceGenerateChallenge,
    RequiredSearchParamsBuilder,
    safeEncodeURL,
    safeTry,
} from '../utils/electron-plugin-utils'

type ExchangeResult = {
    session: Pick<Session, 'createdAt' | 'updatedAt' | 'expiresAt'>
    user: User
}
type SucceedFn = <T>(data: ExchangeResult) => Promise<T | unknown>
type OnDeepLinkSucceedFn = (succeedFn: SucceedFn) => (() => void) | undefined

type FailedFn = (error: unknown) => Promise<unknown> | unknown
type OnDeepLinkFailedFn = (failedFn: FailedFn) => (() => void) | undefined
type NewUserFn = <T>(data: ExchangeResult) => Promise<T | unknown>
type OnDeepLinkNewUserFn = (newUserFn: NewUserFn) => (() => void) | undefined
// Extend the Window interface to include our custom property
const LOCK_NAME_IN_WINDOW = '__BIGIO_BETTER_AUTH_ELECTRON_ATTACHED__'

const checkAndSetGlobalLock = (): boolean => {
    const win = window as typeof window & { [key: string]: unknown }
    if (typeof win[LOCK_NAME_IN_WINDOW] === 'boolean' && win[LOCK_NAME_IN_WINDOW]) {
        return true
    }
    win[LOCK_NAME_IN_WINDOW] = true
    return false
}

const ipcDeepLinkAttachedAtom = atom(false)
const abortSignalAtom = atom<AbortController | null>(null)
const ensureFreshSignal = () => {
    const currentAbortSignal = abortSignalAtom.get()
    if (currentAbortSignal) {
        currentAbortSignal.abort()
    }
    const newAbortSignal = new AbortController()
    abortSignalAtom.set(newAbortSignal)
    return newAbortSignal.signal
}

const isPluginReadyAtom = atom(false)
const appMountedAtom = atom(false)
const succeedResultAtom = atom<ExchangeResult | null>(null)
const newUserResultAtom = atom<ExchangeResult | null>(null)
const errorResultAtom = atom<Error | unknown | null>(null)
const onDeepLinkSucceedFnAtom = atom<SucceedFn | undefined>(undefined)
const onDeepLinkFailedFnAtom = atom<FailedFn | undefined>(undefined)
const onDeepLinkNewUserFnAtom = atom<NewUserFn | undefined>(undefined)
export const electronRendererPlugin = (
    electronRendererPluginOptions: ElectronRendererPluginOptions,
) => {
    const config = { ...defaultRendererPluginOptions, ...electronRendererPluginOptions }
    const {
        refetchSessionOnFocus,
        ELECTRON_SCHEME,
        ELECTRON_CALLBACK_HOST_PATH,
        DEEPLINK_EVENT_NAME,
        BACKEND_EXCHANGE_URL,
        APP_MOUNTED_EVENT_NAME,
        CHALLENGE_NAME_IN_URL,
        TICKET_NAME_IN_URL,
        lazySignalUIReadyForFn,
        FRONTEND_URL,
        PROVIDER_NAME_IN_URL,
        SCOPES_NAME_IN_URL,
        LOGINHINT_NAME_IN_URL,
        ADDITIONAL_DATA_NAME_IN_URL,
        PROVIDERS,
        REQUEST_SIGN_UP_NAME_IN_URL,
        AUTH_STATUS_NAME_IN_URL,
        // ELECTRON_APP_HOST,
    } = config

    function sendAppMounted() {
        if (!isElectronWindow(window)) {
            return
        }
        window.electron.ipcRenderer.send(APP_MOUNTED_EVENT_NAME)
    }
    return {
        id: 'bigio-electron-renderer-plugin',
        $InferServerPlugin: {} as ReturnType<typeof electronServerPlugin>,

        getActions: function ($fetch, $store, options) {
            if (!isElectronWindow(window)) {
                return {
                    bigio: {
                        // biome-ignore lint/suspicious/noEmptyBlockStatements: <>
                        onDeepLinkSuccess: () => () => {},
                        // biome-ignore lint/suspicious/noEmptyBlockStatements: <>
                        onDeepLinkFailed: () => () => {},
                        // biome-ignore lint/suspicious/noEmptyBlockStatements: <>
                        onDeepLinkNewUser: () => () => {},
                    },
                }
            }
            if (!(checkAndSetGlobalLock() || isPluginReadyAtom.get())) {
                consoleLog('[Better-Auth-Electron] Initializing IPC Listeners...')

                if (refetchSessionOnFocus) {
                    const focusEventAbortSignal = ensureFreshSignal()
                    window.addEventListener(
                        'focus',
                        () => {
                            $store.notify('$sessionSignal')
                            // betterAuthClient.getSession()
                        },
                        { signal: focusEventAbortSignal },
                    )
                }
                if (!ipcDeepLinkAttachedAtom.get()) {
                    const dataFromMainZod = z.object({
                        deepLinkURL: z.string().min(1),
                        verifier: z.string().min(1),
                    })

                    window.electron.ipcRenderer.on(
                        DEEPLINK_EVENT_NAME,
                        async (_event, dataFromMain) => {
                            console.log('dataFromMain', dataFromMain)
                            const { data: readyData, error: readyDataError } = await safeTry(
                                async () => {
                                    const bigioErrorStack = [{ ctx: dataFromMain }]
                                    const safeEvent = dataFromMainZod.safeParse(dataFromMain)
                                    if (!safeEvent.success || safeEvent.data === undefined) {
                                        throw new BigIOError(
                                            'Failed to parse dataFromMain with zod',
                                            {
                                                cause: safeEvent.error,
                                                bigioErrorStack: [{ ctx: safeEvent }],
                                            },
                                        )
                                    }

                                    const { deepLinkURL, verifier } = safeEvent.data
                                    const deepLink = new URL(deepLinkURL)

                                    if (deepLink.protocol !== `${ELECTRON_SCHEME}:`) {
                                        throw new BigIOError('Bad Electron Scheme', {
                                            bigioErrorStack: bigioErrorStack,
                                        })
                                    }

                                    const deepLinkHostName = deepLink.hostname.toLowerCase()

                                    if (deepLinkHostName !== ELECTRON_CALLBACK_HOST_PATH) {
                                        throw new BigIOError('Bad CallBackHostPath', {
                                            bigioErrorStack: bigioErrorStack,
                                        })
                                    }
                                    const unknownStatus =
                                        deepLink.searchParams.get(AUTH_STATUS_NAME_IN_URL)

                                    // Challenge Check
                                    const unknownChallenge =
                                        deepLink.searchParams.get(CHALLENGE_NAME_IN_URL)

                                    // if (!challenge) {
                                    //     throw new BigIOError('No Challenge', {
                                    //         bigioErrorStack: bigioErrorStack,
                                    //     })
                                    // }
                                    const deepLinkURLParams = RequiredSearchParamsBuilder(
                                        ELECTRON_SCHEME,
                                        PROVIDERS,
                                    )
                                    const { status, challenge } = deepLinkURLParams
                                        .pick({
                                            challenge: true,
                                            status: true,
                                        })
                                        .parse({
                                            challenge: unknownChallenge,
                                            status: unknownStatus,
                                        })
                                    if (!status) {
                                        throw new BigIOError('there is No status in callbackURL', {
                                            bigioErrorStack: [
                                                { msg: `there is No status in callbackURL` },
                                            ],
                                        })
                                    }
                                    if (status === 'error') {
                                        throw new BigIOError(`oauth login faild at error`, {
                                            bigioErrorStack: [
                                                { msg: `oauth login faild at error` },
                                            ],
                                        })
                                    }
                                    await safeTry(async () => {
                                        const checkChallenge = await pkceGenerateChallenge(verifier)
                                        if (challenge !== checkChallenge) {
                                            throw new BigIOError('That is not my ticket', {
                                                bigioErrorStack: bigioErrorStack,
                                            })
                                        }
                                        return checkChallenge
                                    }, true)

                                    // Ticket Extraction
                                    const deepLinkTicket =
                                        deepLink.searchParams.get(TICKET_NAME_IN_URL)
                                    if (!deepLinkTicket) {
                                        throw new BigIOError('No Ticket', {
                                            bigioErrorStack: bigioErrorStack,
                                        })
                                    }
                                    const exchangeResult = await $fetch<ExchangeResult>(
                                        `/${BACKEND_EXCHANGE_URL}`,
                                        {
                                            method: 'POST',
                                            body: {
                                                ticket: deepLinkTicket,
                                                verifier: verifier,
                                            },
                                        },
                                    )
                                    if (!exchangeResult.data || exchangeResult.error) {
                                        throw new BigIOError('Failed to exchange the ticket', {
                                            bigioErrorStack: [
                                                {
                                                    ctx: {
                                                        deepLinkEvent: dataFromMain,
                                                        fetchError: exchangeResult.error,
                                                    },
                                                },
                                            ],
                                        })
                                    }
                                    return { result: exchangeResult.data, status: status }
                                },
                            )

                            // failed
                            if (!readyData && readyDataError) {
                                const onFailedFn = onDeepLinkFailedFnAtom.get()
                                if (onFailedFn) {
                                    // this is async fn,prevent fake async fn that return promise
                                    // fire and forget
                                    await safeTry(
                                        async () => {
                                            console.log('onFailedFn', onFailedFn)
                                            await onFailedFn(readyDataError)
                                            return false
                                        },
                                        new BigIOError('Failed at onFailedFn', {
                                            bigioErrorStack: [
                                                {
                                                    ctx: String(readyDataError),
                                                },
                                            ],
                                        }),
                                    )
                                    return
                                }
                                console.log('no onFailedFn')
                                errorResultAtom.set(readyDataError)
                                return
                            }

                            $store.notify('$sessionSignal')

                            const originalSessionDate = readyData.result.session
                            const hydratedSession = {
                                createdAt: new Date(originalSessionDate.createdAt),
                                updatedAt: new Date(originalSessionDate.updatedAt),
                                expiresAt: new Date(originalSessionDate.expiresAt),
                            }
                            const userSession = {
                                user: readyData.result.user,
                                session: hydratedSession,
                            }

                            if (readyData.status === 'succeed') {
                                const onSuccessFn = onDeepLinkSucceedFnAtom.get()
                                // this is async fn,prevent fake async fn that return promise
                                // fire and forget
                                if (onSuccessFn) {
                                    await safeTry(
                                        async () => {
                                            console.log('ipc on onSuccessFn')
                                            await onSuccessFn(userSession)
                                            return true
                                        },
                                        new BigIOError('Failed at onSuccessFn', {
                                            bigioErrorStack: [
                                                {
                                                    ctx: {
                                                        deepLinkEvent: dataFromMain,
                                                    },
                                                },
                                            ],
                                        }),
                                    )
                                    return
                                }
                                console.log('no onSuccessFn')
                                succeedResultAtom.set(userSession)
                            }
                            if (readyData.status === 'newUser') {
                                const onNewUserFn = onDeepLinkNewUserFnAtom.get()
                                // this is async fn,prevent fake async fn that return promise
                                // fire and forget
                                if (onNewUserFn) {
                                    await safeTry(
                                        async () => {
                                            console.log('ipc on onNewUserFn')
                                            await onNewUserFn(userSession)
                                            return true
                                        },
                                        new BigIOError('Failed at onNewUserFn', {
                                            bigioErrorStack: [
                                                {
                                                    ctx: {
                                                        deepLinkEvent: dataFromMain,
                                                    },
                                                },
                                            ],
                                        }),
                                    )
                                    return
                                }
                                console.log('no onNewUserFn')
                                newUserResultAtom.set(userSession)
                            }
                            return
                        },
                    )
                    ipcDeepLinkAttachedAtom.set(true)
                }

                // Tell main app is ready handle the coldstart
                // consoleLog('[Client] 發送 App Ready 信號...')
                // if (
                //     !lazySignalUIReadyForFn ||
                //     typeof onDeepLinkSuccessFn === 'function' ||
                //     typeof onDeepLinkFailedFn === 'function'
                // ) {
                //     console.log('onDeepLinkSuccessFn', onDeepLinkSuccessFn)
                //     appMountedAtom.set(true)
                //     sendAppMounted()
                // }

                appMountedAtom.set(true)

                sendAppMounted()
            }

            // Lock it
            isPluginReadyAtom.set(true)
            return {
                bigio: {
                    signInSocial: ({
                        provider,
                        scopes,
                        additionalData,
                        loginHint,
                        requestSignUp,
                    }: {
                        provider: string
                        scopes?: string[]
                        additionalData?: Record<string, unknown>
                        loginHint?: string
                        requestSignUp?: boolean
                    }) => {
                        const targetUrl = new URL(FRONTEND_URL)
                        z.enum(PROVIDERS).parse(provider)
                        targetUrl.searchParams.set(PROVIDER_NAME_IN_URL, provider)

                        const optionalParams = OptionalSearchParamsZodBuilder.parse({
                            scopes: scopes,
                            loginHint: loginHint,
                            additionalData: additionalData,
                            requestSignUp: requestSignUp,
                        })
                        if (optionalParams.scopes) {
                            targetUrl.searchParams.set(
                                SCOPES_NAME_IN_URL,
                                safeEncodeURL(optionalParams.scopes),
                            )
                        }
                        if (optionalParams.loginHint) {
                            targetUrl.searchParams.set(
                                LOGINHINT_NAME_IN_URL,
                                safeEncodeURL(optionalParams.loginHint),
                            )
                        }
                        if (optionalParams.additionalData) {
                            targetUrl.searchParams.set(
                                ADDITIONAL_DATA_NAME_IN_URL,
                                safeEncodeURL(optionalParams.additionalData),
                            )
                        }
                        if (optionalParams.requestSignUp) {
                            targetUrl.searchParams.set(
                                REQUEST_SIGN_UP_NAME_IN_URL,
                                safeEncodeURL(optionalParams.requestSignUp),
                            )
                        }
                        // oringal
                        // const targetUrl = `${FRONTEND_URL}?${PROVIDER_NAME_IN_URL}=${provider}`
                        window.open(targetUrl.toString(), '_blank')
                        return
                    },
                    onDeepLinkSuccess: (succeedFn: SucceedFn) => {
                        if (!isElectronWindow(window)) {
                            return
                        }
                        if (typeof succeedFn !== 'function') {
                            throw new BigIOError('onDeepLinkSuccess must be a function', {
                                bigioErrorStack: [{ ctx: succeedFn }],
                            })
                        }
                        onDeepLinkSucceedFnAtom.set(succeedFn)
                        const succeedBuffer = succeedResultAtom.get()
                        console.log('succeedBuffer', succeedBuffer)
                        if (
                            succeedBuffer &&
                            !(succeedBuffer instanceof Error) &&
                            'user' in succeedBuffer
                        ) {
                            console.log('lazy succeed')
                            succeedFn(succeedBuffer)
                            succeedResultAtom.set(null)
                        }
                        if (typeof onDeepLinkSucceedFnAtom.get() === 'function') {
                            console.log('fn', onDeepLinkSucceedFnAtom.get())
                        }
                        return () => {
                            console.log('unsub')
                            if (onDeepLinkSucceedFnAtom.get() === succeedFn) {
                                onDeepLinkSucceedFnAtom.set(undefined)
                            }
                        }
                    },
                    onDeepLinkFailed: (failedFn: FailedFn) => {
                        if (!isElectronWindow(window)) {
                            return
                        }
                        if (typeof failedFn !== 'function') {
                            throw new BigIOError('onDeepLinkFailed must be a function', {
                                bigioErrorStack: [{ ctx: failedFn }],
                            })
                        }
                        onDeepLinkFailedFnAtom.set(failedFn)
                        const errorBuffer = errorResultAtom.get()
                        console.log('errorBuffer', errorBuffer)
                        if (errorBuffer !== null) {
                            console.log('lazy failed')
                            failedFn(errorBuffer)
                            errorResultAtom.set(null)
                        }
                        if (typeof onDeepLinkFailedFnAtom.get() === 'function') {
                            console.log('fn', onDeepLinkFailedFnAtom.get())
                        }
                        return () => {
                            console.log('unsub')
                            if (onDeepLinkFailedFnAtom.get() === failedFn) {
                                onDeepLinkFailedFnAtom.set(undefined)
                            }
                        }
                    },
                    onDeepLinkNewUser: (newUserFn: NewUserFn) => {
                        if (!isElectronWindow(window)) {
                            return
                        }
                        if (typeof newUserFn !== 'function') {
                            throw new BigIOError('onDeepLinkNewUser must be a function', {
                                bigioErrorStack: [{ ctx: newUserFn }],
                            })
                        }
                        onDeepLinkNewUserFnAtom.set(newUserFn)
                        const newUserBuffer = newUserResultAtom.get()
                        console.log('newUserBuffer', newUserBuffer)
                        if (
                            newUserBuffer &&
                            !(newUserBuffer instanceof Error) &&
                            'user' in newUserBuffer
                        ) {
                            console.log('lazy succeed')
                            newUserFn(newUserBuffer)
                            newUserResultAtom.set(null)
                        }
                        if (typeof onDeepLinkNewUserFnAtom.get() === 'function') {
                            console.log('fn', onDeepLinkNewUserFnAtom.get())
                        }
                        return () => {
                            console.log('unsub')
                            if (onDeepLinkNewUserFnAtom.get() === newUserFn) {
                                onDeepLinkNewUserFnAtom.set(undefined)
                            }
                        }
                    },
                },
            } as unknown as {
                bigio: {
                    signInSocial: (params: {
                        provider: string
                        scopes?: string[]
                        additionalData?: Record<string, unknown>
                        loginHint?: string
                        requestSignUp?: boolean
                    }) => void

                    onDeepLinkSuccess: OnDeepLinkSucceedFn
                    onDeepLinkFailed: OnDeepLinkFailedFn
                    onDeepLinkNewUser: OnDeepLinkNewUserFn
                }
            }
        },
    } satisfies BetterAuthClientPlugin
}
