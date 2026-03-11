/** @type {import('next').NextConfig} */
const config = {
    output: 'export',
    images: { unoptimized: true },
    // Turbopack is the default dev bundler in Next.js 16+.
    // An empty object here tells Next.js we are aware of this, silencing the
    // "webpack config but no turbopack config" startup error.
    // Turbopack handles WASM, node-module stubs, and ESM resolution natively.
    turbopack: {},
    webpack: (config, { isServer }) => {
        // Fixes npm packages that depend on `fs`, `path`, `url` module
        if (!isServer) {
            config.resolve.fallback = {
                ...config.resolve.fallback,
                fs: false,
                path: false,
                url: false,
            };
        }

        // Prevent Webpack from trying to parse raw node-gyp binaries or env checking code
        config.module.rules.push({
            test: /\.m?js/,
            resolve: {
                fullySpecified: false
            }
        });

        // Allow WebAssembly (required by @mlc-ai/web-llm)
        config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
            layers: true,
        };

        return config;
    },

};

export default config;
