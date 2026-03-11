/** @type {import('next').NextConfig} */
const config = {
    output: 'export',
    images: { unoptimized: true },
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

        return config;
    },
};

export default config;
