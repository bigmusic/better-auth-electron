// root/src/server/electron-server-plugin.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BetterAuthPlugin } from 'better-auth'
import {
    APIError,
    createAuthEndpoint,
    createAuthMiddleware,
    sessionMiddleware,
} from 'better-auth/api'
import z from 'zod'
import type { ElectronServerPluginOptions } from '../options/electron-plugin-options'
import { defaultServerPluginOptions } from '../options/electron-plugin-options'
import {
    BigIOError,
    consoleError,
    consoleLog,
    decryptTicket,
    encryptTicket,
    okOr,
    pkceGenerateChallenge,
    RequiredSearchParamsBuilder,
    safeTry,
} from '../utils/electron-plugin-utils'

// ==========================================
// Cookie Attribute Matchers (Safe & Robust)
// ==========================================
const REGEX_SAMESITE_LAX = /(?:^|;)\s*SameSite\s*=\s*Lax/gi
const REGEX_SAMESITE_STRICT = /(?:^|;)\s*SameSite\s*=\s*Strict/gi
const REGEX_HAS_SAMESITE_NONE = /(?:^|;)\s*SameSite\s*=\s*None/i
const REGEX_HAS_SECURE = /(?:^|;)\s*Secure/i

// ==========================================
// Token Validators
// ==========================================
const REGEX_BASE64_URL = /^[a-zA-Z0-9\-_.]+=*$/
const SESSION_TOKEN_REGEX = /(?:^|;)\s*(?:[\w.-]+\.)?session_token=([^;]+)/i

const __dirname = path.dirname(fileURLToPath(import.meta.url))
function getJsPath() {
    let targetPath = path.join(__dirname, 'dist/preact-electron-login.js.gz')

    if (!fs.existsSync(targetPath)) {
        targetPath = path.join(__dirname, '../../dist/preact-electron-login.js.gz')
    }

    return targetPath
}

const getClientIp = (headers: Headers) => {
    const forwarded = headers.get('x-forwarded-for')
    if (forwarded) {
        return forwarded.split(',')[0].trim()
    }

    return '127.0.0.1'
}
function requireSetCookies(headers: Headers) {
    if (typeof headers.getSetCookie !== 'function') {
        throw new BigIOError('Environment Error: headers.getSetCookie is not a function.', {
            bigioErrorStack: [
                {
                    msg: 'Outdated Node.js Environment',
                    ctx: `'Please upgrade NodeJS to 18.14+`,
                },
            ],
        })
    }

    const setCookieHeader = headers.getSetCookie()
    if (!setCookieHeader || setCookieHeader.length === 0) {
        const headerKeys = Array.from(headers.keys()).join(', ')
        throw new APIError('INTERNAL_SERVER_ERROR', {
            message: 'Critical: No Set-Cookie headers received from provider',
            debugInfo: { availableHeaders: headerKeys },
        })
    }
    return setCookieHeader
}
export const electronServerPlugin = (options: ElectronServerPluginOptions) => {
    const config = { ...defaultServerPluginOptions, ...options }
    const {
        ELECTRON_SCHEME,
        WEB_ERROR_PAGE_URL,
        WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME,
        ELECTRON_CALLBACK_HOST_PATH,
        BACKEND_EXCHANGE_URL,
        BACKEND_FAST_TICKET_URL,
        BACKEND_LOGIN_URL,
        PREACT_LOGIN_PAGE,
        TICKET_NAME_IN_URL,
        SCHEME_NAME_IN_URL,
        PROVIDER_NAME_IN_URL,
        CHALLENGE_NAME_IN_URL,
        AUTH_STATUS_NAME_IN_URL,
        TICKET_TTL_SEC,
        ELECTRON_SESSION_DURATION,
        PROVIDERS,
        ELECTRON_TO_BACKEND_HOST_PATH,
        ELECTRON_APP_HOST,
        customPreactJS,
    } = config
    const searchParamsZod = RequiredSearchParamsBuilder(ELECTRON_SCHEME, PROVIDERS)
    const ticketZod = searchParamsZod.extend({
        userid: z.string().min(1, 'User id cannot be empty').regex(REGEX_BASE64_URL),
    })
    return {
        id: 'bigio-electron-server-plugin',
        hooks: {
            after: [
                {
                    matcher: (ctx) => {
                        if (!ctx.path) {
                            return false
                        }
                        return ctx.path.startsWith('/callback')
                    },

                    handler: createAuthMiddleware(async (ctx) => {
                        const redirectURL = await safeTry(async () => {
                            const responseHeaders = ctx.context.responseHeaders
                            if (!responseHeaders) {
                                return false
                            }
                            if (!ctx.request) {
                                return false
                            }
                            const requestUrl = new URL(ctx.request.url)

                            const location = responseHeaders.get('location')
                            if (!location) {
                                return false
                            }

                            const dummyURL = new URL(location, 'http://dummy')
                            console.log(dummyURL.pathname)

                            // -- not electron oauth --
                            if (dummyURL.pathname !== `/${WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME}`) {
                                return false
                            }

                            // -- is electron oauth,so if something got wrong, will short circuit --

                            const searchParams = safeTry(
                                () =>
                                    searchParamsZod.parse({
                                        scheme: dummyURL.searchParams.get(SCHEME_NAME_IN_URL),
                                        provider: dummyURL.searchParams.get(PROVIDER_NAME_IN_URL),
                                        challenge: dummyURL.searchParams.get(CHALLENGE_NAME_IN_URL),
                                        status: dummyURL.searchParams.get(AUTH_STATUS_NAME_IN_URL),
                                    }),
                                new APIError('BAD_REQUEST', {
                                    message: 'Invalid OAuth callback parameters',
                                }),
                            )

                            const { scheme, provider, challenge, status } = searchParams
                            if (!status) {
                                return false
                            }
                            const deepLinkURL = new URL(
                                `${ELECTRON_SCHEME}://${ELECTRON_CALLBACK_HOST_PATH}`,
                            )
                            deepLinkURL.searchParams.set(AUTH_STATUS_NAME_IN_URL, status)
                            deepLinkURL.searchParams.set(CHALLENGE_NAME_IN_URL, challenge)

                            if (status === 'error') {
                                return deepLinkURL
                            }

                            const currentProvider = okOr(
                                requestUrl.pathname.split('/').filter(Boolean).pop(),
                                {
                                    ctx: requestUrl,
                                },
                            )

                            if (provider !== currentProvider) {
                                throw new APIError('FORBIDDEN', {
                                    message: 'CurrentProvider not match electron OAuth provider',
                                })
                            }
                            if (scheme !== ELECTRON_SCHEME) {
                                throw new APIError('FORBIDDEN', {
                                    message: 'Invalid scheme in url',
                                })
                            }
                            const setCookieHeader = safeTry(
                                () => requireSetCookies(responseHeaders),
                                true,
                            )
                            responseHeaders.delete('set-cookie')
                            const tokenMatch = okOr(
                                setCookieHeader
                                    .map((c) => c.match(SESSION_TOKEN_REGEX))
                                    .find((m) => m !== null),
                                new APIError('BAD_REQUEST', {
                                    message: 'Session token not found in response',
                                }),
                            )
                            const sessionTokenInHeader = okOr(
                                decodeURIComponent(tokenMatch[1]).split('.')[0],
                                new APIError('BAD_REQUEST', {
                                    message: 'Failed to decodeURI from token',
                                }),
                            )
                            const userSession = await safeTry(
                                ctx.context.internalAdapter.findSession(sessionTokenInHeader),
                                new APIError('UNAUTHORIZED', {
                                    message: 'User Session not found',
                                }),
                            )
                            const ticket = await safeTry(
                                async () => {
                                    const encryptedTicket = await encryptTicket(
                                        {
                                            userid: userSession.user.id,
                                            scheme: scheme,
                                            provider: provider,
                                            challenge: challenge,
                                            status: status,
                                        },
                                        ctx.context.secret,
                                        TICKET_TTL_SEC,
                                    )
                                    return encryptedTicket
                                },
                                new APIError('FORBIDDEN', {
                                    message: 'Failed to sign ticket',
                                }),
                            )

                            deepLinkURL.searchParams.set(TICKET_NAME_IN_URL, ticket)

                            consoleLog('Deeplink URL:', deepLinkURL)
                            return deepLinkURL
                        })
                        if (!redirectURL.data && redirectURL.error) {
                            consoleError(redirectURL.error)
                            // todo:tell electron there is error
                            return ctx.redirect(WEB_ERROR_PAGE_URL)
                        }
                        if (redirectURL.data === false) {
                            return
                        }
                        if (redirectURL.data) {
                            return ctx.redirect(redirectURL.data.toString())
                        }
                        return
                    }),
                },
                {
                    matcher: (ctx) => {
                        const requestHeaders = ctx.headers
                        const origin = requestHeaders?.get('origin')
                        if (origin && origin === `${ELECTRON_SCHEME}://${ELECTRON_APP_HOST}`) {
                            return true
                        }
                        return false
                    },
                    handler: createAuthMiddleware(async (ctx) => {
                        const responseHeaders = ctx.context.responseHeaders
                        if (!responseHeaders) {
                            return
                        }
                        const setCookieResult = safeTry(() => requireSetCookies(responseHeaders))
                        if (!setCookieResult.data && setCookieResult.error) {
                            return
                        }
                        const fixedCookies = setCookieResult.data.map((cookie) => {
                            const baseCookie = cookie
                                .replace(REGEX_SAMESITE_LAX, 'SameSite=None')
                                .replace(REGEX_SAMESITE_STRICT, 'SameSite=None')

                            const sameSiteSuffix = REGEX_HAS_SAMESITE_NONE.test(baseCookie)
                                ? ''
                                : '; SameSite=None'
                            const secureSuffix = REGEX_HAS_SECURE.test(baseCookie) ? '' : '; Secure'

                            const finalCookie = `${baseCookie}${sameSiteSuffix}${secureSuffix}`
                            return finalCookie
                        })

                        const modifyHeader = safeTry(() => {
                            responseHeaders.delete('set-cookie')

                            for (const cookie of fixedCookies) {
                                responseHeaders.append('set-cookie', cookie)
                            }
                            return responseHeaders
                        })
                        if (modifyHeader.error) {
                            consoleError(modifyHeader.error)
                        }
                        return
                    }),
                },
            ],
        },

        endpoints: {
            exchangeTicket: createAuthEndpoint(
                `/${BACKEND_EXCHANGE_URL}`,
                {
                    method: 'POST',
                    body: z.object({
                        ticket: z.string().min(1, 'Ticket not found').regex(REGEX_BASE64_URL),
                        verifier: z
                            .string()
                            .min(43, 'Verifier too short') // RFC 7636
                            .max(128, 'Verifier too long')
                            .regex(REGEX_BASE64_URL),
                    }),
                },
                async (ctx) => {
                    if (ctx.request === undefined) {
                        throw new APIError('BAD_REQUEST')
                    }
                    const requestHeaders = ctx.headers
                    if (!requestHeaders) {
                        throw new APIError('BAD_REQUEST', {
                            message: 'Missed request Headers',
                        })
                    }

                    const origin = okOr(
                        requestHeaders.get('origin'),
                        new APIError('FORBIDDEN', { message: 'Origin not found' }),
                    )
                    if (!(origin === `${ELECTRON_SCHEME}://${ELECTRON_APP_HOST}`)) {
                        throw new APIError('FORBIDDEN', {
                            message: 'This is an endpoint for electron',
                        })
                    }

                    const ticket = await safeTry(
                        async () => {
                            const decryptedTicket = await decryptTicket<z.infer<typeof ticketZod>>(
                                ctx.body.ticket,
                                ctx.context.secret,
                                // TICKET_SECRET,
                            )
                            const validatedTicket = ticketZod.parse(decryptedTicket)
                            return validatedTicket
                        },
                        new APIError('FORBIDDEN', {
                            message: 'Failed to decrypt or validate ticket',
                        }),
                    )

                    const { userid, scheme, provider, challenge } = ticket
                    if (scheme !== ELECTRON_SCHEME) {
                        throw new APIError('FORBIDDEN', {
                            message: 'Invalid scheme',
                        })
                    }
                    await safeTry(
                        async () => {
                            const computedChallenge = await pkceGenerateChallenge(ctx.body.verifier)
                            if (computedChallenge !== challenge) {
                                throw new BigIOError(
                                    'PKCE verification failed: Challenge mismatch',
                                    {
                                        bigioErrorStack: [
                                            {
                                                ctx: {
                                                    expected: challenge,
                                                    computed: computedChallenge,
                                                    provider: provider,
                                                },
                                            },
                                        ],
                                    },
                                )
                            }
                            return computedChallenge
                        },
                        new APIError('FORBIDDEN', {
                            message: 'Invalid Code Verifier',
                        }),
                    )

                    const user = await safeTry(
                        async () => {
                            const usr = await ctx.context.internalAdapter.findUserById(userid)
                            return usr
                        },
                        new APIError('UNAUTHORIZED', {
                            message: 'User not found',
                        }),
                    )

                    const sessionForElectron = await safeTry(
                        ctx.context.internalAdapter.createSession(user.id, false, {
                            userAgent: ctx.request.headers.get('user-agent') || 'Electron',
                            ipAddress: getClientIp(ctx.request.headers),
                            expiresAt: new Date(Date.now() + ELECTRON_SESSION_DURATION),
                        }),
                        new APIError('INTERNAL_SERVER_ERROR', {
                            message: 'Failed to create session',
                        }),
                    )

                    const tokenConfig = ctx.context.authCookies.sessionToken
                    const signIt = await safeTry(
                        ctx.setSignedCookie(
                            tokenConfig.name,
                            sessionForElectron.token,
                            ctx.context.secret,
                            {
                                // ...tokenConfig.options,
                                httpOnly: true,

                                sameSite: 'none',
                                secure: true,
                                path: '/',
                                maxAge: Math.floor(ELECTRON_SESSION_DURATION / 1000),
                                partitioned: false,
                            },
                        ),
                        new APIError('INTERNAL_SERVER_ERROR', {
                            message: 'Failed to set session cookie',
                        }),
                    )

                    return ctx.json({
                        session: {
                            createdAt: sessionForElectron.createdAt,
                            updatedAt: sessionForElectron.updatedAt,
                            expiresAt: sessionForElectron.expiresAt,
                        },
                        user: user,
                    })
                },
            ),
            fastTicket: createAuthEndpoint(
                `/${BACKEND_FAST_TICKET_URL}`,
                {
                    method: 'POST',
                    body: ticketZod,
                    requireHeaders: true,
                    use: [sessionMiddleware],
                },
                async (ctx) => {
                    if (ctx.request === undefined) {
                        throw new APIError('BAD_REQUEST', { message: 'Missed request header' })
                    }

                    const fastTicketSession = ctx.context.session
                    if (!fastTicketSession) {
                        throw new APIError('UNAUTHORIZED', {
                            message: 'Session invalid or expired',
                        })
                    }

                    const trustedUserId = fastTicketSession.user.id
                    if (trustedUserId !== ctx.body.userid) {
                        throw new APIError('FORBIDDEN', {
                            message: 'User identity mismatch',
                        })
                    }
                    const { scheme, provider, challenge } = ctx.body

                    const ticket = await safeTry(
                        async () => {
                            const encryptedTicket = await encryptTicket(
                                {
                                    userid: trustedUserId,
                                    scheme: scheme,
                                    provider: provider,
                                    challenge: challenge,
                                },
                                ctx.context.secret,
                                TICKET_TTL_SEC,
                            )
                            return encryptedTicket
                        },
                        new APIError('FORBIDDEN', { message: 'Failed to sign ticket' }),
                    )

                    const deepLinkURL = new URL(
                        `${ELECTRON_SCHEME}://${ELECTRON_CALLBACK_HOST_PATH}`,
                    )
                    deepLinkURL.searchParams.set(TICKET_NAME_IN_URL, ticket)
                    deepLinkURL.searchParams.set(CHALLENGE_NAME_IN_URL, challenge)
                    return ctx.json({
                        redirect: deepLinkURL.toString(),
                    })
                },
            ),
        },
    } satisfies BetterAuthPlugin
}
