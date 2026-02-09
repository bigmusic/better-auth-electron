// root/src/main/electron-plugin-main.ts

import { existsSync, promises, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import type { BrowserWindow } from 'electron'
import { app, ipcMain, net, protocol, session, shell } from 'electron'
import log from 'electron-log/main'
import { atom } from 'nanostores'
import z from 'zod'
import type { ElectronMainPluginOptions } from '../options/electron-plugin-options'
import { defaultMainPluginOptions } from '../options/electron-plugin-options'
import {
    BigIOError,
    okOr,
    pkceGenerateChallenge,
    pkceGenerateVerifier,
    safeTry,
} from '../utils/electron-plugin-utils'

log.initialize()
const isInitializedAtom = atom(false)
const deepLinkUrlAtom = atom<string | null>(null)
const browserWindowAtom = atom<BrowserWindow | null>(null)

const getMainWindow = () => {
    const mainWindow = browserWindowAtom.get()
    if (mainWindow?.isDestroyed()) {
        browserWindowAtom.set(null)
    }
    return browserWindowAtom.get()
}

const setMainWindow = (nextWindow: BrowserWindow | null) => {
    if (!nextWindow) {
        browserWindowAtom.set(null)
        return
    }
    if (nextWindow.isDestroyed()) {
        browserWindowAtom.set(null)
        return
    }
    const currentWindow = browserWindowAtom.get()
    if (currentWindow === nextWindow) {
        return
    }

    browserWindowAtom.set(nextWindow)

    nextWindow.once('closed', () => {
        if (browserWindowAtom.get() === nextWindow) {
            browserWindowAtom.set(null)
        }
    })
}

const popUpWindow = (win: BrowserWindow) => {
    if (win.isMinimized()) {
        win.restore()
    }

    if (!win.isVisible()) {
        win.show()
    }

    win.focus()
}
const verifierZod = z.object({
    verifier: z.string(),
    expiresAt: z.number(),
})
export const mainInjection = (options?: ElectronMainPluginOptions) => {
    if (isInitializedAtom.get()) {
        return {
            windowInjection: (mainWindow: BrowserWindow) => null,
            whenReadyInjection: () => null,
        }
    }
    const config = { ...defaultMainPluginOptions, ...options }
    const {
        openHandlerHelper,
        beforeSendHelper,
        customProtocolServingHelper,
        debugMode,
        isOAuth,
        BETTER_AUTH_BASEURL,
        ELECTRON_SCHEME,
        DEEPLINK_EVENT_NAME,
        APP_MOUNTED_EVENT_NAME,
        CLEAR_COOKIES_EVENT_NAME,
        GET_COOKIES_EVENT_NAME,
        ELECTRON_VERIFIER_LENGTH,
        ELECTRON_CALLBACK_HOST_PATH,
        FRONTEND_URL,
        CHALLENGE_NAME_IN_URL,
        SCHEME_NAME_IN_URL,
        PROVIDER_NAME_IN_URL,
        ELECTRON_APP_HOST,
        ELECTRON_RENDERER_PATH,
        ELECTRON_VERIFIER_FILE_NAME,
        PROVIDERS,
        ELECTRON_APP_NAME,
        OLD_SCHOOL_ONBEFORE_WAY,
        CONTENT_SECURITY_POLICY,
    } = config

    // this is a global app name effect OS path
    app.setName(ELECTRON_APP_NAME)
    app.setPath('userData', path.join(app.getPath('appData'), ELECTRON_APP_NAME))
    const {
        scheme: protocolScheme,
        privileges,
        protocolHandleOnCreateWindow,
        protocolHandleOnAppReady,
    } = customProtocolServingHelper ?? {
        scheme: ELECTRON_SCHEME,
        protocolHandleOnCreateWindow: undefined,
        protocolHandleOnAppReady: undefined,
    }
    const RENDERER_ROOT = path.resolve(app.getAppPath(), ELECTRON_RENDERER_PATH)
    const PROTOCOL_SCHEME = protocolScheme ?? ELECTRON_SCHEME

    if (isOAuth) {
        const isPrimaryInstance = app.requestSingleInstanceLock()
        if (!isPrimaryInstance) {
            app.quit()
            // process.exit(0)
        }
    }

    const getElectronVerifier = () => {
        const userDataPath = app.getPath('userData')
        const storagePath = path.join(userDataPath, ELECTRON_VERIFIER_FILE_NAME)

        const TTL_SEC = 1000 * 60 * 2
        const writeVerifier = () => {
            const newVerifier = pkceGenerateVerifier(ELECTRON_VERIFIER_LENGTH)
            const writeResult = safeTry(() => {
                writeFileSync(
                    storagePath,
                    JSON.stringify({
                        verifier: newVerifier,
                        expiresAt: Date.now() + TTL_SEC,
                    }),
                    'utf-8',
                )
                return true
            })

            return newVerifier
        }
        const { data: verifier, error } = safeTry(() => {
            if (existsSync(storagePath)) {
                const raw = readFileSync(storagePath, 'utf-8')
                const data = JSON.parse(raw)
                const now = Date.now()
                const safeData = verifierZod.parse(data)
                if (now < safeData.expiresAt) {
                    return safeData.verifier
                }
                safeTry(() => {
                    unlinkSync(storagePath)
                    return true
                })

                return writeVerifier()
            }

            return writeVerifier()
        })
        if (!verifier || error) {
            if (error) {
                safeTry(() => {
                    unlinkSync(storagePath)
                    return true
                })
            }
            return writeVerifier()
        }

        return verifier
    }

    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient(ELECTRON_SCHEME, process.execPath, [
                path.resolve(process.argv[1]),
            ])
        }
    } else {
        app.setAsDefaultProtocolClient(ELECTRON_SCHEME)
    }

    protocol.registerSchemesAsPrivileged([
        {
            scheme: PROTOCOL_SCHEME,
            privileges: {
                standard: privileges?.standard ?? true,
                secure: privileges?.secure ?? true,
                supportFetchAPI: privileges?.supportFetchAPI ?? true,
                corsEnabled: privileges?.corsEnabled ?? true,
                allowServiceWorkers: privileges?.allowServiceWorkers ?? false,
                bypassCSP: privileges?.bypassCSP ?? false,
                codeCache: privileges?.codeCache ?? true,
                stream: privileges?.stream ?? true,
            },
        },
    ])

    // --- Deep Link Handlers ---
    const sendDeepLinkToRenderer = (deepLinkURL: string) => {
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.webContents.isLoading()) {
            popUpWindow(mainWindow)
            mainWindow.webContents.send('deep-link-received', {
                deepLinkURL: deepLinkURL,
                verifier: getElectronVerifier(),
            })
            deepLinkUrlAtom.set(null)
        } else {
            deepLinkUrlAtom.set(deepLinkURL)
        }
    }
    // for macos deeplink
    app.on('open-url', (event, deepLinkURL) => {
        event.preventDefault()
        const parsedUrl = new URL(deepLinkURL)
        if (parsedUrl.hostname === ELECTRON_CALLBACK_HOST_PATH) {
            sendDeepLinkToRenderer(deepLinkURL)
        }
        return
    })

    if (process.platform === 'win32') {
        const coldStartUrl = process.argv.find((arg) => arg.startsWith(`${ELECTRON_SCHEME}://`))

        if (coldStartUrl) {
            deepLinkUrlAtom.set(coldStartUrl)
        }
    }

    app.on('second-instance', (_event, commandLine, workingDirectory) => {
        const deepLinkURL = commandLine.find((arg) => arg.startsWith(`${ELECTRON_SCHEME}://`))
        if (deepLinkURL) {
            sendDeepLinkToRenderer(deepLinkURL)
        }
    })

    ipcMain.removeAllListeners(APP_MOUNTED_EVENT_NAME)
    ipcMain.on(APP_MOUNTED_EVENT_NAME, (event) => {
        const deepLinkURL = deepLinkUrlAtom.get()
        if (deepLinkURL) {
            event.sender.send(DEEPLINK_EVENT_NAME, {
                deepLinkURL: deepLinkURL,
                verifier: getElectronVerifier(),
            })
            deepLinkUrlAtom.set(null)
        }
    })
    ipcMain.removeHandler(GET_COOKIES_EVENT_NAME)
    ipcMain.handle(GET_COOKIES_EVENT_NAME, async (event) => {
        const callingSession = event.sender.session
        const debugData = await safeTry(
            callingSession.cookies.get({
                url: BETTER_AUTH_BASEURL,
            }),
            true,
        )
    })
    ipcMain.removeHandler(CLEAR_COOKIES_EVENT_NAME)
    ipcMain.handle(CLEAR_COOKIES_EVENT_NAME, async (event) => {
        const callingSession = event.sender.session
        const clearCookie = await safeTry(
            callingSession.clearStorageData({
                storages: ['cookies'],
            }),
        )
        const leftover = await safeTry(callingSession.cookies.get({}))

        if (clearCookie.error || leftover.error) {
            return { success: false }
        }
        if (leftover.data && Array.isArray(leftover.data) && leftover.data.length > 0) {
            for (const c of leftover.data) {
                // log.error(`Failed to clear Cookies - ${c.domain} ${c.name}`)
            }
            return { success: false }
        }
        return {
            success: true,
        }
    })
    const windowInjection = (mainWindow: BrowserWindow) => {
        setMainWindow(mainWindow)

        mainWindow.webContents.setWindowOpenHandler((details) => {
            if (openHandlerHelper) {
                const userDecision = openHandlerHelper(details)
                return userDecision
            }
            const targetUrl = details.url

            if (targetUrl.includes(FRONTEND_URL)) {
                ;(async () => {
                    await safeTry(async () => {
                        const challenge = await safeTry(
                            () => pkceGenerateChallenge(getElectronVerifier()),
                            true,
                        )

                        const url = new URL(targetUrl)
                        const provider = okOr(
                            url.searchParams.get(PROVIDER_NAME_IN_URL),
                            new BigIOError('No provider', {
                                bigioErrorStack: [
                                    {
                                        ctx: targetUrl,
                                    },
                                ],
                            }),
                        )
                        if (!PROVIDERS.includes(provider)) {
                            throw new BigIOError('Error Provider', {
                                bigioErrorStack: [
                                    {
                                        ctx: targetUrl,
                                    },
                                ],
                            })
                        }

                        url.searchParams.set(CHALLENGE_NAME_IN_URL, challenge)
                        url.searchParams.set(SCHEME_NAME_IN_URL, ELECTRON_SCHEME)

                        shell.openExternal(url.toString())
                        return
                    }, true)
                })()

                return { action: 'deny' }
            }
            if (
                targetUrl.startsWith('http') ||
                targetUrl.startsWith('mailto:') ||
                targetUrl.startsWith('tel:')
            ) {
                shell.openExternal(targetUrl)
                return {
                    action: 'deny',
                }
            }
            if (
                targetUrl.startsWith(`${ELECTRON_SCHEME}://`) ||
                targetUrl.startsWith('file://') ||
                targetUrl.startsWith('javascript')
            ) {
                return { action: 'deny' }
            }

            if (targetUrl.startsWith('blob:')) {
                return { action: 'allow' }
            }
            return {
                action: 'deny',
            }
        })
        if (protocolHandleOnCreateWindow) {
            protocolHandleOnCreateWindow(mainWindow)
        } else if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
            mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
        } else {
            mainWindow.loadURL(`${PROTOCOL_SCHEME}://${ELECTRON_APP_HOST}/index.html`)
        }
    }

    const whenReadyInjection = () => {
        // CSP injection
        session.defaultSession.webRequest.onHeadersReceived(
            {
                urls: [`${ELECTRON_SCHEME}://${ELECTRON_APP_HOST}/*`],
            },
            (details, callback) => {
                if (details.resourceType === 'mainFrame') {
                    const fallbackCSP = [
                        "default-src 'self'",
                        `script-src 'self'`,
                        "style-src 'self' 'unsafe-inline'",
                        `img-src 'self' data: blob: https: ${BETTER_AUTH_BASEURL}`,
                        `connect-src 'self' ${BETTER_AUTH_BASEURL}`,
                        "font-src 'self' data:",
                        "frame-ancestors 'none'",
                    ].join('; ')
                    const responseHeaders = {
                        ...details.responseHeaders,
                        'Content-Security-Policy': [CONTENT_SECURITY_POLICY ?? fallbackCSP],
                    }
                    callback({
                        responseHeaders: responseHeaders,
                        cancel: false,
                    })
                    return
                }

                callback({
                    responseHeaders: details.responseHeaders,
                    cancel: false,
                })
                return
            },
        )
        if (OLD_SCHOOL_ONBEFORE_WAY) {
            session.defaultSession.webRequest.onBeforeSendHeaders(
                {
                    urls: [`${BETTER_AUTH_BASEURL}/*`],
                },
                async (details, callback) => {
                    const helperCallback = beforeSendHelper
                        ? beforeSendHelper(details).callback
                        : null
                    if (helperCallback?.cancel === true) {
                        callback({
                            cancel: true,
                        })
                        return
                    }
                    const newHeaders = helperCallback
                        ? {
                              ...details.requestHeaders,
                              ...helperCallback.requestHeaders,
                          }
                        : { ...details.requestHeaders }

                    const CUSTOM_ORIGIN = `${ELECTRON_SCHEME}://${ELECTRON_APP_HOST}`
                    newHeaders.Origin = CUSTOM_ORIGIN
                    newHeaders.Referer = CUSTOM_ORIGIN

                    if (debugMode) {
                        const { data: debugData } = await safeTry(() =>
                            session.defaultSession.cookies.get({
                                url: BETTER_AUTH_BASEURL,
                            }),
                        )
                    }

                    if (!(newHeaders.Cookie || newHeaders.cookie)) {
                        const { data: sessionCookies, error: errorCookie } = await safeTry(() =>
                            session.defaultSession.cookies.get({
                                url: BETTER_AUTH_BASEURL,
                            }),
                        )

                        if (!sessionCookies || sessionCookies.length === 0 || errorCookie) {
                            callback({
                                requestHeaders: newHeaders,
                                // cancel: false
                            })
                            return
                        }
                        const sessionCookiesString = sessionCookies
                            .map((c) => `${c.name}=${c.value}`)
                            .join('; ')
                        newHeaders.Cookie = sessionCookiesString
                    }

                    callback({
                        requestHeaders: newHeaders,
                    })
                    return
                },
            )
        }
        if (protocolHandleOnAppReady) {
            protocol.handle(PROTOCOL_SCHEME, protocolHandleOnAppReady)
        } else {
            const getStaticPath = async (basePath: string, indexFile?: string) => {
                try {
                    const result = await promises.stat(basePath)
                    if (result.isFile()) {
                        return basePath
                    }

                    if (result.isDirectory()) {
                        return getStaticPath(path.join(basePath, `${indexFile}.html`))
                    }
                } catch {
                    // biome-ignore lint/nursery/noUselessUndefined: <>
                    return undefined
                }
                // biome-ignore lint/nursery/noUselessUndefined: <>
                return undefined
            }
            protocol.handle(PROTOCOL_SCHEME, async (request) => {
                const { hostname, pathname } = new URL(request.url)

                if (hostname !== ELECTRON_APP_HOST) {
                    return new Response('Forbidden Host', { status: 403 })
                }

                const ioResult = await safeTry(async () => {
                    const { data: targetPath, error: decodeURIError } = safeTry(() =>
                        path.normalize(path.join(RENDERER_ROOT, decodeURIComponent(pathname))),
                    )
                    if (!targetPath && decodeURIError) {
                        return new Response('Bad Request: Malformed URL', { status: 400 })
                    }
                    const indexPath = path.join(RENDERER_ROOT, 'index.html')
                    const relativePath = path.relative(RENDERER_ROOT, targetPath)
                    const isNotSafe = relativePath.startsWith('..') || path.isAbsolute(relativePath)
                    if (isNotSafe) {
                        return new Response('Access Denied', { status: 403 })
                    }
                    const finalPath = await getStaticPath(targetPath, 'index')
                    if (!finalPath) {
                        const ext = path.extname(targetPath)
                        if (!ext || (ext !== '.html' && ext !== '.asar')) {
                            return new Response('File Not Found', { status: 404 })
                        }
                    }
                    const fileToServe = finalPath || indexPath
                    const response = await net.fetch(pathToFileURL(fileToServe).toString())
                    if (fileToServe.endsWith('.map') && response.ok) {
                        const headers = new Headers(response.headers)
                        headers.set('Content-Type', 'application/json')

                        const body = await response.arrayBuffer()
                        return new Response(body, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: headers,
                        })
                    }
                    return response
                })
                if (!ioResult.data && ioResult.error) {
                    console.error('Protocol IO Error:', ioResult.error)
                    return new Response('Internal Server Error', { status: 500 })
                }
                return ioResult.data ?? new Response('Unknown Error', { status: 500 })
            })
        }
    }
    isInitializedAtom.set(true)
    return {
        windowInjection: windowInjection,
        whenReadyInjection: whenReadyInjection,
    }
}
