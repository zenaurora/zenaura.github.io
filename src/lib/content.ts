import { SITE } from "@/consts"
import { getCollection, type CollectionEntry } from "astro:content"
import { isSubpost } from "@/lib/utils"

export const pageTitle = (title: string) => `${title} | ${SITE.title}`

export async function getPosts(): Promise<CollectionEntry<"blog">[]> {
  const posts = await getCollection("blog", ({ data }) => !data.draft)
  return posts
    .filter((post) => !isSubpost(post.id))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
}

export async function getPapers(): Promise<CollectionEntry<"papers">[]> {
  const papers = await getCollection("papers", ({ data }) => !data.draft)
  return papers.sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
}

export async function getDailies(): Promise<CollectionEntry<"daily">[]> {
  const dailies = await getCollection("daily")
  return dailies.sort(
    (a, b) =>
      b.data.date.getTime() - a.data.date.getTime() ||
      a.data.topic.localeCompare(b.data.topic),
  )
}

/** 日报话题的展示文案与强调色（oklch 固定色相，配合 color-mix 适配各主题） */
export const DAILY_TOPICS: Record<string, { label: string; accent: string }> = {
  rust: { label: "Rust", accent: "oklch(68% 0.15 45)" },
  racing: { label: "赛车", accent: "oklch(62% 0.19 20)" },
}

export const dailyTopic = (topic: string) =>
  DAILY_TOPICS[topic] ?? { label: topic, accent: "oklch(65% 0.1 260)" }

export async function getSubposts(): Promise<
  Map<string, CollectionEntry<"blog">[]>
> {
  const posts = await getCollection(
    "blog",
    ({ id, data }) => !data.draft && id.split("/").length === 2,
  )
  posts.sort(
    (a, b) =>
      (a.data.order ?? Infinity) - (b.data.order ?? Infinity) ||
      a.data.date.getTime() - b.data.date.getTime(),
  )
  const series = new Map<string, CollectionEntry<"blog">[]>()
  for (const post of posts) {
    const parent = post.id.split("/")[0]
    const siblings = series.get(parent)
    if (siblings) siblings.push(post)
    else series.set(parent, [post])
  }
  return series
}

export async function getTags(): Promise<
  Map<string, CollectionEntry<"blog">[]>
> {
  const posts = await getPosts()
  const series = await getSubposts()
  const tags = new Map<string, CollectionEntry<"blog">[]>()
  for (const post of posts) {
    const chain = [post, ...(series.get(post.id) ?? [])]
    for (const tag of new Set(
      chain.flatMap((entry) => entry.data.tags ?? []),
    )) {
      const tagged = tags.get(tag)
      if (tagged) tagged.push(post)
      else tags.set(tag, [post])
    }
  }
  return new Map(
    [...tags].sort(
      ([a, postsA], [b, postsB]) =>
        postsB.length - postsA.length || a.localeCompare(b),
    ),
  )
}
