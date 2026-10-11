import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// GitHub Pages serves the site under /<repository>; set NEXT_PUBLIC_BASE_PATH there.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  webpack(config) {
    // One copy of Yjs for the editor's collaboration entry point and the demo's provider.
    config.resolve.alias = { ...config.resolve.alias, yjs: path.dirname(require.resolve('yjs/package.json')) };
    return config;
  },
};
