export type PlanStatus = "active" | "paused" | "shipped" | "shelved"
export type DeliverableKind = "post" | "paper" | "project" | "external"

export interface Deliverable {
  url: string
  kind: DeliverableKind
}

export interface Plan {
  id: string
  title: string
  status: PlanStatus
  addedAt: string
  finishedAt?: string
  deliverable?: Deliverable
  reflection?: string
  tags?: string[]
}

export const STATUS_ORDER: PlanStatus[] = [
  "active",
  "paused",
  "shipped",
  "shelved",
]

export const STATUS_LABEL: Record<PlanStatus, string> = {
  active: "Active",
  paused: "Paused",
  shipped: "Shipped",
  shelved: "Shelved",
}

export const STATUS_ACCENT: Record<PlanStatus, string> = {
  active: "oklch(68% 0.15 145)",
  paused: "oklch(75% 0.13 75)",
  shipped: "oklch(65% 0.10 220)",
  shelved: "oklch(60% 0.02 260)",
}

export function groupByStatus(plans: Plan[]): Record<PlanStatus, Plan[]> {
  const groups: Record<PlanStatus, Plan[]> = {
    active: [],
    paused: [],
    shipped: [],
    shelved: [],
  }
  for (const plan of plans) groups[plan.status].push(plan)
  for (const status of STATUS_ORDER) {
    groups[status].sort((a, b) => {
      const aDate = a.finishedAt ?? a.addedAt
      const bDate = b.finishedAt ?? b.addedAt
      return bDate.localeCompare(aDate)
    })
  }
  return groups
}

export function shortenUrl(url: string): string {
  if (url.startsWith("/")) return url
  try {
    const u = new URL(url)
    const path = u.pathname === "/" ? "" : u.pathname
    return u.hostname.replace(/^www\./, "") + path
  } catch {
    return url
  }
}
