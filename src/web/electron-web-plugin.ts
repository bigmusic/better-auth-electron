// root/packages/better-auth-electron/src/web/electron-web-plugin.ts

import { useStore } from '@nanostores/react'
import type {
    BetterAuthClientPlugin,
    BetterAuthError,
    Prettify,
    SessionQueryParams,
} from 'better-auth'
import type {
    BetterFetch,
    BetterFetchError,
    BetterFetchOption,
    createAuthClient,
} from 'better-auth/client'
import type { Atom } from 'nanostores'
import { atom, onMount } from 'nanostores'
import type { ElectronWebOptions } from '../options/electron-plugin-options'
import { defatultWebOptions } from '../options/electron-plugin-options'
import { BigIOError } from '../utils/electron-plugin-env'
import { safeTry } from '../utils/electron-plugin-helper'
import { SearchParamsZod } from '../utils/electron-plugin-utils'
import { lazyClient } from './electron-web-clientHelper'

type StandardAuthClient = ReturnType<typeof createAuthClient>
export const setLazyClient = (client: unknown) => lazyClient.set(client)

const LOCK_NAME_IN_WINDOW = '__BIGIO_BETTER_AUTH_ELECTRON_WEB_ATTACHED__'

const checkAndSetGlobalLock = (): boolean => {
    const win = window as typeof window & { [key: string]: unknown }
    if (typeof win[LOCK_NAME_IN_WINDOW] === 'boolean' && win[LOCK_NAME_IN_WINDOW]) {
        return true
    }
    win[LOCK_NAME_IN_WINDOW] = true
    return false
}
// const isLoaded = atom(false)

export const electronWebHandoffPlugin = <
    T extends {
        $Infer: {
            Session: {
                session: unknown
                user: unknown
            }
        }
    },
>() => {
    type SessionType = T['$Infer']['Session']['session']
    type UserType = T['$Infer']['Session']['user']
    type UseSessionData = {
        data: { user: UserType; session: SessionType }
        error: BetterFetchError | null
        isPending: boolean
        isRefetching: boolean
        refetch: (
            queryParams?:
                | {
                      query?: SessionQueryParams
                  }
                | undefined,
        ) => Promise<void>
    }
    const config: ElectronWebOptions = { ...defatultWebOptions }
    const {
        CHALLENGE_NAME_IN_URL,
        PROVIDER_NAME_IN_URL,
        SCHEME_NAME_IN_URL,
        PROVIDERS,
        ELECTRON_SCHEME,
        WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME,
        BACKEND_FAST_TICKET_URL,
    } = config
    const electronWebAtoms = ($fetch: BetterFetch) => {
        const handoffStatus = atom<'idle' | 'connecting' | 'succeed' | 'failed'>('idle')
        const handoffMessage = atom<{
            msg: 'idle' | 'succeed' | 'failed'
            ctx?: unknown
        }>({
            msg: 'idle',
        })
        const myAtom = atom<null>(null)
        return {
            handoffStatus: handoffStatus,
            handoffMessage: handoffMessage,
            myAtom: myAtom,
        }
    }
    type ElectronWebAtoms = ReturnType<typeof electronWebAtoms>

    return {
        id: 'electron-web-handoff',

        getAtoms: ($fetch) => electronWebAtoms($fetch),

        getActions: ($fetch, $store) => {
            console.log('getActions')
            const sessionAtom = $store.atoms.session as Atom<UseSessionData>

            const { handoffStatus, handoffMessage } = $store.atoms as unknown as ElectronWebAtoms
            const handoffLogic = () => {
                console.log('handoffLogic')
                const { data: sessionData, isPending, isRefetching, error } = sessionAtom.get()
                if (isPending || isRefetching || error) {
                    return
                }

                if (handoffStatus.get() !== 'idle') {
                    return
                }

                const searchParams = new URLSearchParams(window.location.search)
                const scheme = searchParams.get(SCHEME_NAME_IN_URL)
                if (!scheme) {
                    return
                }
                if (scheme !== ELECTRON_SCHEME) {
                    handoffMessage.set({
                        msg: 'failed',
                        ctx: `Wrong Scheme: ${scheme}`,
                    })
                    handoffStatus.set('failed')
                    return
                }
                const provider = searchParams.get(PROVIDER_NAME_IN_URL)
                const challenge = searchParams.get(CHALLENGE_NAME_IN_URL)
                const searchParamsZod = SearchParamsZod(ELECTRON_SCHEME, [...PROVIDERS])
                const searchParamsObj = {
                    scheme: scheme,
                    provider: provider,
                    challenge: challenge,
                }
                const validParams = searchParamsZod.parse(searchParamsObj)

                const client = lazyClient.get() as StandardAuthClient
                if (!client) {
                    return
                }
                const performFastLogin = async () => {
                    console.log('檢測到有效 Session,啟動快速通道...')
                    handoffStatus.set('connecting')
                    const { data: fastLoginResult, error: fastLoginError } = await safeTry(
                        async () => {
                            const { data: fastTicketData, error: fastTicketError } =
                                await client.$fetch<{
                                    redirect: string
                                }>(`/${BACKEND_FAST_TICKET_URL}`, {
                                    method: 'POST',
                                    body: {
                                        userid: (sessionData?.user as { id: unknown }).id,
                                        scheme: scheme,
                                        provider: provider,
                                        challenge: challenge,
                                    },
                                    credentials: 'include',
                                })
                            if (fastTicketError || !fastTicketData.redirect) {
                                handoffStatus.set('failed')
                                throw new BigIOError('Failed to get fast ticket', {
                                    bigioErrorStack: [
                                        { msg: 'Failed to get fast ticket', ctx: validParams },
                                    ],
                                })
                            }
                            const targetUrl = fastTicketData.redirect
                            if (!targetUrl.startsWith(`${scheme}://`)) {
                                handoffStatus.set('failed')
                                console.error(
                                    `Failed to get fast ticket with Wrong Scheme: ${scheme}`,
                                )
                                throw new BigIOError(
                                    `Failed to get fast ticket with Wrong Scheme: ${scheme}`,
                                    {
                                        bigioErrorStack: [
                                            { msg: 'Failed to get fast ticket', ctx: scheme },
                                        ],
                                    },
                                )
                            }
                            return fastTicketData
                        },
                    )
                    if (!fastLoginResult || fastLoginError) {
                        handoffStatus.set('failed')
                        handoffMessage.set({
                            msg: 'failed',
                            ctx: searchParamsObj,
                        })
                        return false
                    }

                    window.location.href = fastLoginResult.redirect
                    handoffStatus.set('succeed')
                    handoffMessage.set({ msg: 'succeed' })
                    return true
                }
                const handleLogin = async (loginProvider: (typeof PROVIDERS)[number]) => {
                    console.log('登錄ing')
                    handoffStatus.set('connecting')
                    const { data: loginData, error: loginError } = await safeTry(async () => {
                        const callbackURL = new URL(
                            `/${WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME}`,
                            window.location.origin,
                        )

                        callbackURL.searchParams.set(SCHEME_NAME_IN_URL, validParams.scheme)
                        callbackURL.searchParams.set(PROVIDER_NAME_IN_URL, validParams.provider)
                        callbackURL.searchParams.set(CHALLENGE_NAME_IN_URL, validParams.challenge)

                        const relativeCallbackURL = callbackURL.pathname + callbackURL.search
                        await client.signIn.social({
                            provider: loginProvider,
                            callbackURL: relativeCallbackURL,
                        })

                        return true
                    })
                    if (!loginData || loginError) {
                        handoffStatus.set('failed')
                        handoffMessage.set({
                            msg: 'failed',
                            ctx: searchParamsObj,
                        })
                        return false
                    }
                    handoffStatus.set('succeed')
                    handoffMessage.set({ msg: 'succeed' })
                    return true
                }
                if (sessionData) {
                    performFastLogin()
                } else {
                    handleLogin(provider as (typeof PROVIDERS)[number])
                }
            }
            if (!checkAndSetGlobalLock()) {
                onMount(sessionAtom, () => {
                    console.log('onMount')
                })
                sessionAtom.listen((aatom) => {
                    handoffLogic()
                    console.log('listen', aatom)
                })
            }

            // window.addEventListener('hashchange', () => {
            //     console.log(' [Handoff] Hash changed, re-running logic')
            //     // handoffLogic()
            // })

            // window.addEventListener('popstate', () => {
            //     console.log('history [Handoff] History navigation detected')
            //     // handoffLogic()
            // })
            return {
                bigio: {
                    useElectronOAuthSession: () => {
                        const { data, error, isPending, isRefetching, refetch } =
                            useStore(sessionAtom)

                        const oauthMessage = useStore<typeof handoffMessage>(
                            $store.atoms.handoffMessage,
                        )

                        return {
                            data: data,
                            error: error,
                            isPending: isPending,
                            isRefetching: isRefetching,
                            refetch: refetch,
                            oauthMessage: oauthMessage,
                        }
                    },
                },
            }
        },
    } satisfies BetterAuthClientPlugin
}
