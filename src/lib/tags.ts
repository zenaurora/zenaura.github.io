export const FULLY_AI_TAG = "fully AI"

export function isFullyAiTag(tag: string) {
  return (
    tag.trim().replace(/\s+/g, " ").toLowerCase() === FULLY_AI_TAG.toLowerCase()
  )
}

export function visibleTags(tags: string[], limit: number) {
  const visible = tags.slice(0, limit)
  const fullyAiTag = tags.find(isFullyAiTag)

  if (fullyAiTag && !visible.some(isFullyAiTag)) {
    visible[visible.length - 1] = fullyAiTag
  }

  return visible
}
