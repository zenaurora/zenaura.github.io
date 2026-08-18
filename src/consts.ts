import type { SvgComponent } from "astro/types"
import Email from "@/assets/icons/email.svg"
import GitHub from "@/assets/icons/github.svg"
import RSS from "@/assets/icons/rss.svg"
import Twitter from "@/assets/icons/twitter.svg"

export const SITE = {
  title: "maokaihe's blog",
  description: "My blog built with astro-erudite.",
  author: "maokaihe",
  locale: "en-US",
  dir: "ltr",
  defaultPageImage: "/static/opengraph-image.png",
  defaultPostImage: "/static/1200x630.png",
  featuredPostCount: 2,
} as const

export const NAVIGATION = [
  { href: "/blog", label: "Blog" },
  { href: "/timeline", label: "Timeline" },
  { href: "/papers", label: "Papers" },
  { href: "/daily", label: "Daily" },
  { href: "/projects", label: "Projects" },
  { href: "/authors", label: "Authors" },
]

export const PROTECTED_CONTENT = {
  researchIdeas: {
    parentId: "research-ideas",
    passwordHash:
      "fcb9d2f309338d01268126c28e70ca6757ca0898df961df726b39be667214a07",
    storageKey: "research-ideas-access",
  },
} as const

export const SOCIALS: { href: string; label: string; icon: SvgComponent }[] = [
  { href: "https://github.com/zenaurora", label: "GitHub", icon: GitHub },
  { href: "https://x.com/ecrofmaomao", label: "Twitter", icon: Twitter },
  { href: "mailto:ecrofmaomao@gmail.com", label: "Email", icon: Email },
  { href: "/rss.xml", label: "RSS", icon: RSS },
]
