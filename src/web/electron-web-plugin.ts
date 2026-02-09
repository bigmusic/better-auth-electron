// root/packages/better-auth-electron/src/web/electron-web-plugin.ts

import { useStore } from '@nanostores/react'
import type { BetterAuthClientPlugin, SessionQueryParams } from 'better-auth'
import type { BetterFetch, BetterFetchError, createAuthClient } from 'better-auth/client'
import type { Atom } from 'nanostores'
import { atom } from 'nanostores'
import type { ElectronWebOptions } from '../options/electron-plugin-options'
import { defatultWebOptions } from '../options/electron-plugin-options'
import { BigIOError, SearchParamsZod, safeTry } from '../utils/electron-plugin-utils'
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
        const handoffError = atom<string | null>(null)
        const handoffStatus = atom<'idle' | 'pending' | 'connecting' | 'succeed' | 'failed'>('idle')
        const fastLogin = atom<boolean | null>(null)
        return {
            handoffError: handoffError,
            handoffStatus: handoffStatus,
            fastLogin: fastLogin,
        }
    }
    type ElectronWebAtoms = ReturnType<typeof electronWebAtoms>

    return {
        id: 'bigio-electron-webhandoff-plugin',
        getAtoms: ($fetch) => electronWebAtoms($fetch),
        getActions: ($fetch, $store) => {
            const sessionAtom = $store.atoms.session as Atom<UseSessionData>

            const { handoffStatus, handoffError, fastLogin } =
                $store.atoms as unknown as ElectronWebAtoms

            const handoffLogic = () => {
                if (handoffStatus.get() !== 'idle' && handoffStatus.get() !== 'pending') {
                    return
                }
                const { data: sessionData, isPending, isRefetching, error } = sessionAtom.get()
                if (isPending || isRefetching || error) {
                    return
                }

                const searchParams = new URLSearchParams(window.location.search)
                const scheme = searchParams.get(SCHEME_NAME_IN_URL)
                if (!scheme) {
                    return
                }
                if (scheme !== ELECTRON_SCHEME) {
                    handoffStatus.set('failed')
                    handoffError.set(`Wrong Scheme: ${scheme}`)
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
                                throw new BigIOError(
                                    `Failed to get fast ticket with Wrong Scheme: ${scheme}`,
                                    {
                                        bigioErrorStack: [
                                            {
                                                msg: 'Failed to get fast ticket with Wrong Scheme',
                                                ctx: scheme,
                                            },
                                        ],
                                    },
                                )
                            }
                            return fastTicketData
                        },
                    )
                    if (!fastLoginResult || fastLoginError) {
                        handoffStatus.set('failed')
                        handoffError.set('Can not perform fast login')
                        return false
                    }

                    window.location.href = fastLoginResult.redirect
                    handoffStatus.set('succeed')
                    return true
                }
                const handleLogin = async (loginProvider: (typeof PROVIDERS)[number]) => {
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
                        const social = await client.signIn.social({
                            provider: loginProvider,
                            callbackURL: relativeCallbackURL,
                            // additionalData
                            // disableRedirect
                            // errorCallbackURL
                            // fetchOptions
                            // idToken
                            // loginHint
                            // newUserCallbackURL
                            // requestSignUp
                            // scopes
                        })

                        return social
                    })
                    if (!loginData || loginError) {
                        handoffStatus.set('failed')
                        handoffError.set('Failed to perform oauth login')
                        return false
                    }
                    handoffStatus.set('succeed')
                    return true
                }
                if (sessionData.session) {
                    const isFastLogin = fastLogin.get()
                    if (isFastLogin === true) {
                        performFastLogin()
                    }
                    if (isFastLogin === false) {
                        handleLogin(provider as (typeof PROVIDERS)[number])
                    }
                    if (isFastLogin === null) {
                        handoffStatus.set('pending')
                        return
                    }
                } else {
                    handleLogin(provider as (typeof PROVIDERS)[number])
                }
            }
            if (!checkAndSetGlobalLock()) {
                sessionAtom.listen((aatom) => {
                    handoffLogic()
                })
                fastLogin.listen(() => {
                    handoffStatus.set('idle')
                    handoffLogic()
                })
            }

            const setFastLogin = (decision: boolean) => {
                fastLogin.set(decision)
            }
            return {
                bigio: {
                    useElectronOAuthSession: () => {
                        const { data, error, isPending, isRefetching, refetch } =
                            useStore(sessionAtom)
                        const oauthError = useStore<typeof handoffError>(handoffError)

                        const oauthStatus = useStore<typeof handoffStatus>(handoffStatus)

                        return {
                            data: data,
                            error: error,
                            isPending: isPending,
                            isRefetching: isRefetching,
                            refetch: refetch,
                            oauthStatus: oauthStatus,
                            oauthError: oauthError,
                            setFastLogin: setFastLogin,
                        }
                    },
                },
            }
        },
    } satisfies BetterAuthClientPlugin
}
