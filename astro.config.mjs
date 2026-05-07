// @ts-check
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'

// NOTE: site 字段是占位符,后续接入自定义域时替换。
// 绝对不要在代码其他地方 hardcode 域名,统一从 Astro.site 读。
export default defineConfig({
  site: 'https://marvis-loong.pages.dev' /* TODO: 替换为最终域名 */,
  // 不设置 base —— 站点始终挂在根路径,避免 ${base}/path 双斜杠问题
  integrations: [
    mdx(),
    sitemap(),
  ],
  markdown: {
    shikiConfig: {
      theme: 'night-owl',
      wrap: true,
    },
  },
  vite: {
    server: {
      // 本地开发时禁用 host check,方便手机扫码预览
      host: true,
    },
  },
})
