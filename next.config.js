/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse 和 xlsx 使用 Node.js 原生模块，需要排除在 Edge Runtime 之外
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'xlsx'],
  },
}

module.exports = nextConfig
