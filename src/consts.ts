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
  { href: "/now", label: "Now" },
  { href: "/timeline", label: "Timeline" },
  { href: "/papers", label: "Papers" },
  { href: "/daily", label: "Daily" },
  { href: "/projects", label: "Projects" },
  { href: "/authors", label: "Authors" },
]

export const SOCIALS: { href: string; label: string; icon: SvgComponent }[] = [
  { href: "https://github.com/zenaurora", label: "GitHub", icon: GitHub },
  { href: "https://x.com/ecrofmaomao", label: "Twitter", icon: Twitter },
  { href: "mailto:ecrofmaomao@gmail.com", label: "Email", icon: Email },
  { href: "/rss.xml", label: "RSS", icon: RSS },
]
