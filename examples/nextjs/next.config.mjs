import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets Next compile the linked local package; not needed when installed from npm.
  transpilePackages: ['@gamine/wordcraft-react'],
  // The linked package has its own node_modules (with yjs for its type checks); make sure only
  // this app's copy of yjs is bundled. Not needed when installed from npm (yjs is a peer dependency).
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, yjs: path.resolve('node_modules/yjs') };
    return config;
  },
};
export default nextConfig;
