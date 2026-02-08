// root/src/utils/electron-plugin-options.ts

import type { BetterAuthClientOptions, Session, User } from 'better-auth'
import type { AuthClient } from 'better-auth/client'
import type { BrowserWindow } from 'electron'
// import { renderOAuthPage } from '../preact/electron-login'
// import type { BigIOError } from '../utils/electron-plugin-env'

export type ElectronServerPluginOptions = {
    /**
     * The custom protocol scheme used for deep linking authentication.
     * @remarks
     * This should match the protocol registered in your Electron Main Process.
     * Do not include the `://` suffix.
     * @example "bigio" to be like "bigio://better-auth-callback"
     */
    ELECTRON_SCHEME: string
    PROVIDERS: string[]
    // baseURL?: string
    // cookiePrefix?: string
    // logger?: typeof bigIOLogger | typeof logsgh
    debugMode?: boolean
    WEB_ERROR_PAGE_URL?: string
    WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME?: string
    ELECTRON_TO_BACKEND_HOST_PATH?: string
    ELECTRON_APP_HOST?: string

    /**
     * The specific action path or host used to identify the auth callback.
     * This will be combined with the scheme to form the full callback URL.
     * Format: `${scheme}://${hostname}`
     * @example "better-auth-callback"
     * // Resulting URL: "bigio://better-auth-callback"
     */
    ELECTRON_CALLBACK_HOST_PATH?: string
    /**
     * The IPC event name used to receive deep link URLs from the main process.
     * @example "deep-link-received"
     */
    DEEPLINK_EVENT_NAME?: string
    /**
     * The IPC event name used to notify the main process that the renderer app is mounted.
     * @example "renderer-app-mounted"
     */
    APP_MOUNTED_EVENT_NAME?: string
    /**
     * The URL path for the backend exchange endpoint to exchange the JWT ticket.
     * @example "/electron/exchange"
     */
    BACKEND_EXCHANGE_URL?: string
    BACKEND_FAST_TICKET_URL?: string
    BACKEND_LOGIN_URL?: string
    PREACT_LOGIN_PAGE?: (
        baseURL?: string | undefined,
        scheme?: string | undefined,
        provider?: string | undefined,
    ) => string
    customPreactJS?: string
    TICKET_NAME_IN_URL?: string
    SCHEME_NAME_IN_URL?: string
    PROVIDER_NAME_IN_URL?: string
    CHALLENGE_NAME_IN_URL?: string
    TICKET_TTL_SEC?: number
    ELECTRON_SESSION_DURATION?: number
}

export type ElectronRendererPluginOptions = {
    /**
     * The custom protocol scheme used for deep linking authentication.
     * @remarks
     * This should match the protocol registered in your Electron Main Process.
     * Do not include the `://` suffix.
     * @example "bigio" to be like "bigio://better-auth-callback"
     */
    ELECTRON_SCHEME: string
    // baseURL?: string
    // cookiePrefix?: string
    // logger?: typeof bigIOLogger | typeof log
    // betterAuthClient: AuthClient<BetterAuthClientOptions>
    debug?: boolean
    refetchSessionOnFocus?: boolean
    CHALLENGE_NAME_IN_URL?: string
    ELECTRON_APP_HOST?: string
    TICKET_NAME_IN_URL?: string
    onDeepLinkFailedFn?: (error: unknown) => Promise<void>
    onDeepLinkSuccessFn?: (data: {
        session: Pick<Session, 'createdAt' | 'updatedAt' | 'expiresAt'>
        user: User
    }) => Promise<void>
    lazySignalUIReadyForFn?: boolean
    /**
     * The specific action path or host used to identify the auth callback.
     * This will be combined with the scheme to form the full callback URL.
     * Format: `${scheme}://${hostname}`
     * @example "better-auth-callback"
     * // Resulting URL: "bigio://better-auth-callback"
     */
    ELECTRON_CALLBACK_HOST_PATH?: string
    /**
     * The IPC event name used to receive deep link URLs from the main process.
     * @example "deep-link-received"
     */
    DEEPLINK_EVENT_NAME?: string
    /**
     * The IPC event name used to notify the main process that the renderer app is mounted.
     * @example "renderer-app-mounted"
     */
    APP_MOUNTED_EVENT_NAME?: string
    /**
     * The URL path for the backend exchange endpoint to exchange the JWT ticket.
     * @example "/electron/exchange"
     */
    BACKEND_EXCHANGE_URL?: string
}
export type ElectronMainPluginOptions = {
    isOAuth: boolean
    /**
     * The custom protocol scheme used for deep linking authentication.
     * @remarks
     * This should match the protocol registered in your Electron Main Process.
     * Do not include the `://` suffix.
     * @example "bigio" to be like "bigio://better-auth-callback"
     */
    ELECTRON_SCHEME: string
    BETTER_AUTH_BASEURL: string
    PROVIDERS: string[]
    FRONTEND_URL: string
    ELECTRON_APP_NAME: string
    CONTENT_SECURITY_POLICY?: string
    /**
     * The specific action path or host used to identify the auth callback.
     * This will be combined with the scheme to form the full callback URL.
     * Format: `${scheme}://${hostname}`
     * @example "better-auth-callback"
     * // Resulting URL: "bigio://better-auth-callback"
     */
    // logger?: typeof bigIOLogger | typeof log
    debugMode?: boolean
    ELECTRON_VERIFIER_LENGTH?: number
    CHALLENGE_NAME_IN_URL?: string
    SCHEME_NAME_IN_URL?: string
    PROVIDER_NAME_IN_URL?: string
    CALLBACK_PATHNAME_IN_URL?: string
    WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME?: string
    ELECTRON_APP_HOST?: string
    ELECTRON_RENDERER_PATH?: string
    OLD_SCHOOL_ONBEFORE_WAY?: boolean
    GET_COOKIES_EVENT_NAME?: string
    ELECTRON_VERIFIER_FILE_NAME?: string
    /**
     * The specific action path or host used to identify the auth callback.
     * This will be combined with the scheme to form the full callback URL.
     * Format: `${scheme}://${hostname}`
     * @example "better-auth-callback"
     * // Resulting URL: "bigio://better-auth-callback"
     */
    ELECTRON_CALLBACK_HOST_PATH?: string
    /**
     * The IPC event name used to receive deep link URLs from the main process.
     * @example "deep-link-received"
     */
    DEEPLINK_EVENT_NAME?: string
    /**
     * The IPC event name used to clear cookies from the main process.
     * @example "clear-Cookies"
     */
    CLEAR_COOKIES_EVENT_NAME?: string
    /**
     * The IPC event name used to notify the main process that the renderer app is mounted.
     * @example "renderer-app-mounted"
     */
    APP_MOUNTED_EVENT_NAME?: string
    /**
     * The URL path for the backend exchange endpoint to exchange the JWT ticket.
     * @example "/electron/exchange"
     */
    BACKEND_EXCHANGE_URL?: string
    openHandlerHelper?: (details: Electron.HandlerDetails) => Electron.WindowOpenHandlerResponse

    beforeSendHelper?: (details: Electron.OnBeforeSendHeadersListenerDetails) => {
        callback: {
            requestHeaders: Record<string, string | string[]>
            cancel?: boolean
        }
    }
    customProtocolServingHelper?: {
        scheme?: string
        privileges?: {
            standard: boolean
            secure: boolean
            supportFetchAPI: boolean
            corsEnabled: boolean
            bypassCSP: boolean
            allowServiceWorkers?: boolean
            codeCache?: boolean
            stream?: boolean
        }
        protocolHandleOnCreateWindow?: (mainWindow: BrowserWindow) => Promise<void>
        protocolHandleOnAppReady?: (request: Request) => Response | Promise<Response>
    }
}
export type ElectronButtonOptions = {
    FRONTEND_URL: string
    PROVIDER_NAME_IN_URL: string
}
export type ElectronWebOptions = typeof defatultWebOptions

export const defaultServerPluginOptions = {
    ELECTRON_SCHEME: 'bigio',
    ELECTRON_APP_HOST: 'app-renderer',
    PROVIDERS: ['github', 'google'],
    BACKEND_EXCHANGE_URL: 'electron/exchange',
    BACKEND_FAST_TICKET_URL: 'electron/fastTicket',
    WEB_ERROR_PAGE_URL: 'http://localhost:3001/better-auth',
    WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME: 'electron-handoff',
    ELECTRON_CALLBACK_HOST_PATH: 'better-auth-callback',
    ELECTRON_TO_BACKEND_HOST_PATH: 'from-electron-to-auth-backend',
    BACKEND_LOGIN_URL: 'electron/login',
    // PREACT_LOGIN_PAGE: renderOAuthPage,
    TICKET_NAME_IN_URL: 'ticket',
    SCHEME_NAME_IN_URL: 'scheme',
    PROVIDER_NAME_IN_URL: 'provider',
    CHALLENGE_NAME_IN_URL: 'electron_challenge',
    TICKET_TTL_SEC: 60 * 5,
    ELECTRON_SESSION_DURATION: 7 * 24 * 60 * 60 * 1000,
    // customPreactJS: customPreactJS,
} satisfies Partial<ElectronServerPluginOptions>

export const defaultRendererPluginOptions = {
    ELECTRON_SCHEME: 'bigio',
    ELECTRON_APP_HOST: 'app-renderer',
    BACKEND_EXCHANGE_URL: 'electron/exchange',
    refetchSessionOnFocus: true,
    ELECTRON_CALLBACK_HOST_PATH: 'better-auth-callback',
    DEEPLINK_EVENT_NAME: 'deep-link-received',
    APP_MOUNTED_EVENT_NAME: 'renderer-app-mounted',
    CHALLENGE_NAME_IN_URL: 'electron_challenge',
    TICKET_NAME_IN_URL: 'ticket',
    lazySignalUIReadyForFn: false,
} satisfies Partial<ElectronRendererPluginOptions>

export const defaultMainPluginOptions = {
    debugMode: false,
    isOAuth: true,
    BETTER_AUTH_BASEURL: 'http://localhost:3002',
    ELECTRON_APP_NAME: 'bigio-electron-demo',
    PROVIDERS: ['github', 'google'],
    ELECTRON_APP_HOST: 'app-renderer',
    ELECTRON_SCHEME: 'bigio',
    ELECTRON_RENDERER_PATH: 'out/renderer',
    DEEPLINK_EVENT_NAME: 'deep-link-received',
    APP_MOUNTED_EVENT_NAME: 'renderer-app-mounted',
    CLEAR_COOKIES_EVENT_NAME: 'clear-Cookies',
    GET_COOKIES_EVENT_NAME: 'get-Cookies',
    ELECTRON_VERIFIER_LENGTH: 32,
    FRONTEND_URL: 'http://localhost:3002/oauth',
    WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME: 'electron-handoff',
    SCHEME_NAME_IN_URL: 'scheme',
    PROVIDER_NAME_IN_URL: 'provider',
    CHALLENGE_NAME_IN_URL: 'electron_challenge',
    CALLBACK_PATHNAME_IN_URL: 'callbackpath',
    OLD_SCHOOL_ONBEFORE_WAY: false,
    ELECTRON_CALLBACK_HOST_PATH: 'better-auth-callback',
    ELECTRON_VERIFIER_FILE_NAME: 'bigio-auth-state.json',
} satisfies Partial<ElectronMainPluginOptions>

export const defaultButtonOptions = {
    FRONTEND_URL: 'http://localhost:3001/oauth',
    PROVIDER_NAME_IN_URL: 'provider',
} satisfies Partial<ElectronButtonOptions>

export const defatultWebOptions = {
    ELECTRON_SCHEME: 'bigio',
    SCHEME_NAME_IN_URL: 'scheme',
    PROVIDERS: ['github', 'google'],
    PROVIDER_NAME_IN_URL: 'provider',
    CHALLENGE_NAME_IN_URL: 'electron_challenge',
    WEB_OAUTH_SIGNIN_CALLBACK_PATHNAME: 'electron-handoff',
    BACKEND_FAST_TICKET_URL: 'electron/fastTicket',
} as const
