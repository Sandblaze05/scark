/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  distDir: process.env.NODE_ENV === 'production' ? '../app' : '.next',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },

  // Turbopack is the default dev bundler in Next.js 16+.
  // An empty object here tells Next.js we are aware of this, silencing the
  // "webpack config but no turbopack config" startup warning.
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
      }
    }

    // Prevent Webpack from trying to parse raw node-gyp binaries or
    // ESM modules that use import().meta — required by @mlc-ai/web-llm
    config.module.rules.push({
      test: /\.m?js/,
      resolve: {
        fullySpecified: false,
      },
    })

    // Allow WebAssembly (required by @mlc-ai/web-llm for shader compilation)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    }

    return config
  },
}
