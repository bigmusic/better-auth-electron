// packages/core/src/server/better-auth/ui/oauth-page.tsx
/** @jsxImportSource preact */
import { Fragment, h } from 'preact'
import { render } from 'preact-render-to-string'

export const renderOAuthPage = (baseURL?: string, scheme?: string, provider?: string) => {
    const html = (
        // biome-ignore lint/a11y/useHtmlLang: <>
        <html>
            {/** biome-ignore lint/style/noHeadElement: <> */}
            <head>
                <meta charSet='utf-8' />
                <title>Redirecting...</title>
                {/* <script src='https://cdn.tailwindcss.com'></script> */}
            </head>
            <body>
                <div data-base-url={baseURL} data-provider={provider} data-scheme={scheme} id='app'>
                    <div style='padding: 20px; text-align: center;'>Loading Scriptssssssss...</div>
                </div>

                <script src='/api/auth/electron/static/client.js' type='module'></script>
            </body>
        </html>
    )

    return `<!DOCTYPE html>${render(html)}`
}
