/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets Next compile the linked local package; not needed when installed from npm.
  transpilePackages: ['@gamine/wordcraft-react'],
};
export default nextConfig;
