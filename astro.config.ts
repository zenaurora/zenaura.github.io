import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import { satteri } from "@astrojs/markdown-satteri"
import {
  blockExpressiveCode,
  inlineExpressiveCode,
} from "./src/lib/expressive-code"
import { temmlMath } from "./src/lib/math"
import { calloutDirective } from "./src/lib/callout"
import { externalLinks } from "./src/lib/external-links"
import { headingNamespace } from "./src/lib/heading-namespace"
import { headingAnchors } from "./src/lib/heading-anchors"

export default defineConfig({
  base: "/",
  site: "https://zenaurora.github.io/",
  output: "static",
  // astro 7 默认 compressHTML: 'jsx' 会吃掉内联元素间空格，恢复 HTML 语义压缩（同上游 da49805）
  compressHTML: true,
  prefetch: { prefetchAll: true },
  integrations: [
    sitemap({
      filter: (page) =>
        !/\/blog\/[^/]+\/[^/]+\/?$/.test(page) &&
        !page.includes("/blog/research-ideas") &&
        !page.includes("/tags/"),
    }),
  ],
  markdown: {
    syntaxHighlight: false,
    processor: satteri({
      features: { directive: true, math: true },
      mdastPlugins: [calloutDirective, inlineExpressiveCode, temmlMath],
      hastPlugins: [externalLinks, blockExpressiveCode, headingNamespace, headingAnchors],
    }),
  },
})
