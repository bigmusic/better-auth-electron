// packages/core/src/server/better-auth/electron-preact-oauth.tsx

// import { authClient } from '@bigworks/core/client/better-auth/auth-client'
/** @jsxImportSource preact */
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

const appRoot = document.getElementById('app')
const rootBaseURL = appRoot?.dataset.baseUrl || ''
const rootProvider = appRoot?.dataset.provider || ''
const rootScheme = appRoot?.dataset.scheme || ''

function PreactOAuth({
    baseURL,
    scheme,
    provider,
}: {
    baseURL?: string
    scheme?: string
    provider?: string
}) {
    // const {
    //     data: useSessionData,
    //     error,
    //     isPending,
    //     isRefetching,
    //     refetch,
    // } = authClient.useSession()
    const [count, setCount] = useState(0)
    useEffect(() => {
        console.log('useEffect')
    }, [])
    return (
        <>
            <button
                onClick={() => {
                    setCount((prev) => prev + 1)
                }}
                type='button'>
                {count}
            </button>
            <div>dsaf</div>
            {/* <div>{useSessionData ? useSessionData.user.name : 'no login'}</div> */}
            <div>laksdjflkajsdflkjl</div>
        </>
    )
}

if (appRoot) {
    render(
        <PreactOAuth baseURL={rootBaseURL} provider={rootProvider} scheme={rootScheme} />,
        appRoot,
    )
}
