// root/packages/better-auth-electron/client/better-auth/electron-renderer-plugin.ts

import type { BetterAuthClientPlugin, Session, User } from 'better-auth'
import { createStore, atom as jotaiAtom } from 'jotai/vanilla'
import { atom } from 'nanostores'
import z from 'zod'
import type { ElectronRendererPluginOptions } from '../options/electron-plugin-options'
import { defaultRendererPluginOptions } from '../options/electron-plugin-options'
import type { electronServerPlugin } from '../server/electron-server-plugin'
import { BigIOError, consoleError, consoleLog } from '../utils/electron-plugin-env'
import { safeTry } from '../utils/electron-plugin-helper'
import { isElectronWindow, pkceGenerateChallenge } from '../utils/electron-plugin-utils'

type ExchangeResult = {
    session: Pick<Session, 'createdAt' | 'updatedAt' | 'expiresAt'>
    user: User
}
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
// =================================================================
// Module Level Internal State Machine
// =================================================================
const _rendererPluginStore = createStore()

// IPC Listener Lock Atom
const _ipcDeepLinkAtom = jotaiAtom(false)
const ipcDeepLinkAttached = () => _rendererPluginStore.set(_ipcDeepLinkAtom, true)
const isIpcDeepLinkAttached = () => _rendererPluginStore.get(_ipcDeepLinkAtom)

const _abortSignalAtom = jotaiAtom<AbortController | null>(null)
const _ensureFreshSignalAtom = jotaiAtom(null, (get, set) => {
    const currentAbortSignal = get(_abortSignalAtom)
    if (currentAbortSignal) {
        currentAbortSignal.abort()
    }
    const newAbortSignal = new AbortController()
    set(_abortSignalAtom, newAbortSignal)
    return newAbortSignal.signal
})
const ensureFreshSignal = () => _rendererPluginStore.set(_ensureFreshSignalAtom)

const _isPluginReadyAtom = jotaiAtom(false)
const setIsPluginReady = () => _rendererPluginStore.set(_isPluginReadyAtom, true)
const getIsPluginReady = () => _rendererPluginStore.get(_isPluginReadyAtom)

// appMounted Lock
const _appMountedAtom = jotaiAtom(false)
const setAppMounted = () => _rendererPluginStore.set(_appMountedAtom, true)
const getAppMounted = () => _rendererPluginStore.get(_appMountedAtom)

// sessionData Store
const _resultFromDeepLinkAtom = jotaiAtom<ExchangeResult | Error | null>(null)
const setResult = (data: ExchangeResult | Error | null) =>
    _rendererPluginStore.set(_resultFromDeepLinkAtom, data)
const getResult = () => _rendererPluginStore.get(_resultFromDeepLinkAtom)

// fn atom
const _onDeepLinkSuccessFnAtom =
    jotaiAtom<ElectronRendererPluginOptions['onDeepLinkSuccessFn']>(undefined)

const setOnDeepLinkSuccessFn = (fn: ElectronRendererPluginOptions['onDeepLinkSuccessFn']) => {
    if (fn) {
        _rendererPluginStore.set(_onDeepLinkSuccessFnAtom, () => fn)
    }
}
const getOnDeepLinkSuccessFn = () => _rendererPluginStore.get(_onDeepLinkSuccessFnAtom)
const _onDeepLinkFailedFnAtom =
    jotaiAtom<ElectronRendererPluginOptions['onDeepLinkFailedFn']>(undefined)
const setOnDeepLinkFailedFn = (fn: ElectronRendererPluginOptions['onDeepLinkFailedFn']) => {
    if (fn) {
        _rendererPluginStore.set(_onDeepLinkFailedFnAtom, () => fn)
    }
}
const getDeepLinkFailedFn = () => _rendererPluginStore.get(_onDeepLinkFailedFnAtom)

export const electronRendererPlugin = (
    electronRendererPluginOptions: ElectronRendererPluginOptions,
) => {
    const config = { ...defaultRendererPluginOptions, ...electronRendererPluginOptions }
    const {
        // betterAuthClient,
        refetchSessionOnFocus,
        ELECTRON_SCHEME,
        ELECTRON_CALLBACK_HOST_PATH,
        DEEPLINK_EVENT_NAME,
        BACKEND_EXCHANGE_URL,
        APP_MOUNTED_EVENT_NAME,
        CHALLENGE_NAME_IN_URL,
        TICKET_NAME_IN_URL,
        onDeepLinkSuccessFn,
        onDeepLinkFailedFn,
        lazySignalUIReadyForFn,
        // ELECTRON_APP_HOST,
    } = config
    if (typeof onDeepLinkSuccessFn === 'function') {
        setOnDeepLinkSuccessFn(onDeepLinkSuccessFn)
    }
    if (typeof onDeepLinkFailedFn === 'function') {
        setOnDeepLinkFailedFn(onDeepLinkFailedFn)
    }
    function sendAppMounted() {
        if (!isElectronWindow(window)) {
            return
        }
        window.electron.ipcRenderer.send(APP_MOUNTED_EVENT_NAME)
    }
    return {
        id: 'bigio-electron-renderer-plugin',
        $InferServerPlugin: {} as ReturnType<typeof electronServerPlugin>,
        getAtoms: ($fetch) => {
            const myAtom = atom<null>(null)
            return {
                myAtom: myAtom,
            }
        },
        getActions: function ($fetch, $store, options) {
            if (!isElectronWindow(window)) {
                return {
                    bigio: {
                        onDeepLinkSuccess: () => null,
                        onDeepLinkFailed: () => null,
                    },
                }
            }
            if (!(checkAndSetGlobalLock() || getIsPluginReady())) {
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
                if (!isIpcDeepLinkAttached()) {
                    const dataFromMainZod = z.object({
                        deepLinkURL: z.string().min(1),
                        verifier: z.string().min(1),
                    })

                    window.electron.ipcRenderer.on(
                        DEEPLINK_EVENT_NAME,
                        async (_event, dataFromMain) => {
                            console.log(dataFromMain)
                            const { data: readyData, error: dataError } = await safeTry(
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

                                    // Challenge Check
                                    const challenge =
                                        deepLink.searchParams.get(CHALLENGE_NAME_IN_URL)

                                    console.log(challenge)
                                    if (!challenge) {
                                        throw new BigIOError('Error Challenge', {
                                            bigioErrorStack: bigioErrorStack,
                                        })
                                    }
                                    console.log(challenge)
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
                                    return { ticket: deepLinkTicket, verifier: verifier }
                                },
                            )
                            console.log(dataError)

                            const onFailedFn = getDeepLinkFailedFn()
                            if (!readyData && dataError) {
                                if (
                                    lazySignalUIReadyForFn &&
                                    (typeof onDeepLinkSuccessFn === 'function' ||
                                        typeof onDeepLinkFailedFn === 'function')
                                ) {
                                    setResult(dataError)
                                }
                                if (onFailedFn) {
                                    // this is async fn,prevent fake async fn that return promise
                                    // fire and forget
                                    safeTry(
                                        () => onFailedFn(dataError),
                                        new BigIOError('Failed at onFailedFn', {
                                            bigioErrorStack: [
                                                {
                                                    ctx: String(dataError),
                                                },
                                            ],
                                        }),
                                    )
                                    return
                                }
                                if (dataError instanceof BigIOError) {
                                    consoleError(dataError)
                                } else {
                                    console.error(
                                        `[Better-auth-electron-plugin] Unknown Error: ${dataError instanceof Error ? dataError.message : String(dataError)}`,
                                    )
                                }
                                return
                            }

                            // Exchange Ticket
                            const result = await $fetch<ExchangeResult>(
                                `/${BACKEND_EXCHANGE_URL}`,
                                {
                                    method: 'POST',
                                    body: {
                                        ticket: readyData.ticket,
                                        verifier: readyData.verifier,
                                    },
                                },
                            )
                            if (result.error) {
                                const bigIOError = new BigIOError('Failed to exchange the ticket', {
                                    bigioErrorStack: [
                                        {
                                            ctx: {
                                                deepLinkEvent: dataFromMain,
                                                fetchError: result.error,
                                            },
                                        },
                                    ],
                                })
                                if (
                                    lazySignalUIReadyForFn &&
                                    (typeof onDeepLinkSuccessFn === 'function' ||
                                        typeof onDeepLinkFailedFn === 'function')
                                ) {
                                    setResult(bigIOError)
                                }
                                if (onFailedFn) {
                                    // this is async fn,prevent fake async fn that return promise
                                    // fire and forget
                                    safeTry(() => onFailedFn(result.error), bigIOError)
                                    return
                                }
                                consoleError(bigIOError)
                                return
                            }
                            $store.notify('$sessionSignal')

                            const originalSessionDate = result.data.session
                            const hydratedSession = {
                                createdAt: new Date(originalSessionDate.createdAt),
                                updatedAt: new Date(originalSessionDate.updatedAt),
                                expiresAt: new Date(originalSessionDate.expiresAt),
                            }
                            const userSession = { user: result.data.user, session: hydratedSession }
                            if (
                                lazySignalUIReadyForFn &&
                                (typeof onDeepLinkSuccessFn === 'function' ||
                                    typeof onDeepLinkFailedFn === 'function')
                            ) {
                                setResult(userSession)
                            }
                            const onSuccessFn = getOnDeepLinkSuccessFn()
                            if (onSuccessFn) {
                                // this is async fn,prevent fake async fn that return promise
                                // fire and forget
                                safeTry(
                                    () => onSuccessFn(userSession),
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
                            }
                            return
                        },
                    )
                    ipcDeepLinkAttached()
                }

                // Tell main app is ready handle the coldstart
                consoleLog('[Client] 發送 App Ready 信號...')
                if (
                    !lazySignalUIReadyForFn ||
                    typeof onDeepLinkSuccessFn === 'function' ||
                    typeof onDeepLinkFailedFn === 'function'
                ) {
                    setAppMounted()
                    sendAppMounted()
                }
            }

            // Lock it
            setIsPluginReady()
            return {
                bigio: {
                    onDeepLinkSuccess: (
                        fn: ElectronRendererPluginOptions['onDeepLinkSuccessFn'],
                    ) => {
                        if (!isElectronWindow(window)) {
                            return
                        }
                        if (typeof fn === 'function') {
                            setOnDeepLinkSuccessFn(fn)
                        }
                        if (lazySignalUIReadyForFn) {
                            if (!getAppMounted()) {
                                setAppMounted()
                                sendAppMounted()
                                return
                            }
                            const result = getResult()
                            if (!(result instanceof Error) && result && fn) {
                                safeTry(
                                    async () => {
                                        await fn(result)
                                        setResult(null)
                                    },
                                    new BigIOError('Failed at lazy onSuccessFn', {
                                        bigioErrorStack: [
                                            {
                                                ctx: result,
                                            },
                                        ],
                                    }),
                                )
                            }
                            return
                        }
                    },
                    onDeepLinkFailed: (fn: ElectronRendererPluginOptions['onDeepLinkFailedFn']) => {
                        if (!isElectronWindow(window)) {
                            return
                        }
                        if (typeof fn === 'function') {
                            setOnDeepLinkFailedFn(fn)
                        }
                        if (lazySignalUIReadyForFn) {
                            if (!getAppMounted()) {
                                setAppMounted()
                                sendAppMounted()
                                return
                            }
                            const result = getResult()
                            if (result instanceof Error && fn) {
                                safeTry(
                                    async () => {
                                        await fn(result)
                                        setResult(null)
                                    },
                                    new BigIOError('Failed at lazy onFailedFn', {
                                        bigioErrorStack: [
                                            {
                                                ctx: String(result),
                                            },
                                        ],
                                    }),
                                )
                            }
                            return
                        }
                    },
                },
            }
        },
    } satisfies BetterAuthClientPlugin
}
