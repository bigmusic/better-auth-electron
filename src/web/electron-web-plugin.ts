// root/src/web/electron-web-plugin.ts

import { useStore } from '@nanostores/react'
import type { BetterAuthClientPlugin, SessionQueryParams } from 'better-auth'
import type { BetterFetch, BetterFetchError, createAuthClient } from 'better-auth/client'
import type { Atom } from 'nanostores'
import { atom } from 'nanostores'
import type { ElectronWebOptions } from '../options/electron-plugin-options'
import { defaultWebOptions } from '../options/electron-plugin-options'
import {
    BigIOError,
    OptionalSearchParamsZodBuilder,
    RequiredSearchParamsBuilder,
    safeDecodeURL,
    safeTry,
} from '../utils/electron-plugin-utils'
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
    const config: ElectronWebOptions = { ...defaultWebOptions }
    const {
        CHALLENGE_NAME_IN_URL,
        PROVIDER_NAME_IN_URL,
        SCHEME_NAME_IN_URL,
        PROVIDERS,
        ELECTRON_SCHEME,
        WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME,
        BACKEND_FAST_TICKET_URL,
        SCOPES_NAME_IN_URL,
        LOGINHINT_NAME_IN_URL,
        ADDITIONAL_DATA_NAME_IN_URL,
        REQUEST_SIGN_UP_NAME_IN_URL,
        AUTH_STATUS_NAME_IN_URL,
    } = config
    const electronWebAtoms = ($fetch: BetterFetch) => {
        const handoffError = atom<string | null>(null)
        const handoffStatus = atom<'idle' | 'pending' | 'connecting' | 'succeed' | 'failed'>('idle')
        const fastLogin = atom<boolean | null>(null)
        const initializationErrorAtom = atom<Error | null>(null)
        return {
            handoffError: handoffError,
            handoffStatus: handoffStatus,
            fastLogin: fastLogin,
            initializationErrorAtom: initializationErrorAtom,
        }
    }
    type ElectronWebAtoms = ReturnType<typeof electronWebAtoms>

    return {
        id: 'bigio-electron-webhandoff-plugin',
        getAtoms: ($fetch) => electronWebAtoms($fetch),
        getActions: ($fetch, $store) => {
            const sessionAtom = $store.atoms.session as Atom<UseSessionData>

            const {
                handoffStatus,
                handoffError,
                fastLogin: fastLoginAtom,
                initializationErrorAtom,
            } = $store.atoms as unknown as ElectronWebAtoms

            const handoffLogic = async () => {
                // 'connecting' | 'succeed' | 'failed' early return
                // only 'idle' and 'pending' will run the logic
                if (handoffStatus.get() !== 'idle' && handoffStatus.get() !== 'pending') {
                    return false
                }
                const { data: sessionData, isPending, isRefetching, error } = sessionAtom.get()
                if (isPending || isRefetching || error) {
                    return false
                }
                const searchParams = new URLSearchParams(window.location.search)
                const scheme = searchParams.get(SCHEME_NAME_IN_URL)
                if (!scheme) {
                    return false
                }
                if (scheme !== ELECTRON_SCHEME) {
                    throw new BigIOError(`Wrong Scheme: ${scheme}`, {
                        bigioErrorStack: [
                            {
                                msg: `Wrong Scheme: ${scheme}`,
                            },
                        ],
                    })
                }
                const provider = searchParams.get(PROVIDER_NAME_IN_URL)
                if (!provider) {
                    return false
                }
                const challenge = searchParams.get(CHALLENGE_NAME_IN_URL)
                if (!challenge) {
                    return false
                }

                const SearchParamsZod = RequiredSearchParamsBuilder(ELECTRON_SCHEME, [...PROVIDERS])
                const requiredValidParams = SearchParamsZod.parse({
                    scheme: scheme,
                    provider: provider,
                    challenge: challenge,
                })

                const scopes = searchParams.get(SCOPES_NAME_IN_URL)
                const loginHint = searchParams.get(LOGINHINT_NAME_IN_URL)
                const additionalData = searchParams.get(ADDITIONAL_DATA_NAME_IN_URL)
                const requestSignUp = searchParams.get(REQUEST_SIGN_UP_NAME_IN_URL)

                const optionalValidParams = OptionalSearchParamsZodBuilder.parse({
                    scopes: scopes ? safeDecodeURL(scopes) : undefined,
                    loginHint: loginHint ? safeDecodeURL(loginHint) : undefined,
                    additionalData: additionalData ? safeDecodeURL(additionalData) : undefined,
                    requestSignUp: requestSignUp ? safeDecodeURL(requestSignUp) : undefined,
                })

                const client = lazyClient.get() as StandardAuthClient
                if (!client) {
                    throw new BigIOError('handoff fn faild to get AuthClient', {
                        bigioErrorStack: [{ msg: 'check the init authClient code' }],
                    })
                }
                const fastLogin = async () => {
                    handoffStatus.set('connecting')
                    return await safeTry(async () => {
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
                            throw new BigIOError('Failed to get fast ticket', {
                                bigioErrorStack: [
                                    {
                                        msg: 'Failed to get fast ticket',
                                        ctx: {
                                            requiredValidParams: requiredValidParams,
                                            error: fastTicketError,
                                        },
                                    },
                                ],
                            })
                        }
                        const targetUrl = fastTicketData.redirect
                        if (!targetUrl.startsWith(`${scheme}://`)) {
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

                        handoffStatus.set('succeed')
                        window.location.href = targetUrl
                        return sessionData.user
                    }, true)
                }

                const parseURL = (status: string) => {
                    const callbackURL = new URL(
                        `/${WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME}`,
                        window.location.origin,
                    )
                    callbackURL.searchParams.set(AUTH_STATUS_NAME_IN_URL, status)
                    callbackURL.searchParams.set(SCHEME_NAME_IN_URL, requiredValidParams.scheme)
                    callbackURL.searchParams.set(PROVIDER_NAME_IN_URL, requiredValidParams.provider)
                    callbackURL.searchParams.set(
                        CHALLENGE_NAME_IN_URL,
                        requiredValidParams.challenge,
                    )
                    return callbackURL.pathname + callbackURL.search
                }
                const regularLogin = async (loginProvider: (typeof PROVIDERS)[number]) => {
                    handoffStatus.set('connecting')
                    return await safeTry(async () => {
                        const { data: socialData, error: socialError } = await client.signIn.social(
                            {
                                provider: loginProvider,
                                callbackURL: parseURL('succeed'),
                                scopes: optionalValidParams.scopes,
                                additionalData: optionalValidParams.additionalData,
                                loginHint: optionalValidParams.loginHint,
                                requestSignUp: optionalValidParams.requestSignUp,
                                disableRedirect: false,
                                errorCallbackURL: parseURL('error'),
                                newUserCallbackURL: parseURL('newUser'),
                            },
                        )
                        if (!socialData || socialError) {
                            throw new BigIOError(`Faild to sign in with ${loginProvider}`, {
                                bigioErrorStack: [
                                    {
                                        ctx: {
                                            provider: loginProvider,
                                            error: socialError,
                                        },
                                    },
                                ],
                            })
                        }
                        handoffStatus.set('succeed')
                        return socialData
                    }, true)
                }
                if (sessionData?.session) {
                    if (optionalValidParams.requestSignUp) {
                        return await regularLogin(provider as (typeof PROVIDERS)[number])
                    }
                    const isFastLogin = fastLoginAtom.get()
                    if (isFastLogin === true) {
                        return await fastLogin()
                    }
                    if (isFastLogin === false) {
                        return await regularLogin(provider as (typeof PROVIDERS)[number])
                    }
                    if (isFastLogin === null) {
                        handoffStatus.set('pending')
                        return true
                    }
                } else {
                    return await regularLogin(provider as (typeof PROVIDERS)[number])
                }
                return false
            }
            // const { data, error } = safeTry(() => handoffLogic())
            if (!checkAndSetGlobalLock()) {
                sessionAtom.listen(async (aatom) => {
                    console.log(sessionAtom.get())
                    const { data, error } = await safeTry(() => handoffLogic())
                    if (error) {
                        handoffStatus.set('failed')
                        handoffError.set(error.message)
                        initializationErrorAtom.set(error)
                        console.error(error)
                    }
                })
                fastLoginAtom.listen(async () => {
                    handoffStatus.set('idle')
                    const { data, error } = await safeTry(() => handoffLogic())
                    if (error) {
                        handoffStatus.set('failed')
                        handoffError.set(error.message)
                        initializationErrorAtom.set(error)
                        console.error(error)
                    }
                })
            }

            const setFastLogin = (decision: boolean) => {
                fastLoginAtom.set(decision)
            }
            return {
                bigio: {
                    useElectronOAuthSession: () => {
                        const initializationError = initializationErrorAtom.get()
                        if (initializationError instanceof Error) {
                            console.error(initializationError)
                            initializationErrorAtom.set(null)
                        }
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
