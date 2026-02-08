// root/tsup.config.ts
import { defineConfig } from 'tsup'

// biome-ignore lint/style/noDefaultExport: <>
export default defineConfig({
    entry: {
        main: 'src/main/electron-main-plugin.ts', // -> dist/main.js
        renderer: 'src/renderer/electron-renderer-plugin.ts', // -> dist/renderer.js
        server: 'src/server/electron-server-plugin.ts', // -> dist/server.js
        web: 'src/web/electron-web-plugin.ts', // -> dist/web.js
        options: 'src/options/electron-plugin-options.ts',
    },

    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    metafile: true,
    external: [
        'electron',
        'better-auth',
        'preact',
        'preact-render-to-string',
        'react',
        'react-dom',
    ],
    noExternal: ['@nanostores/react', '@oslojs/encoding', 'electron-log', 'nanostores'],
    minify: false,
})
