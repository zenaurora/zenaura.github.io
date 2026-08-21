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
  active: "进行中",
  paused: "已暂停",
  shipped: "已完成",
  shelved: "已搁置",
}

export const STATUS_ACCENT: Record<PlanStatus, string> = {
  active: "oklch(68% 0.15 145)",
  paused: "oklch(75% 0.13 75)",
  shipped: "oklch(65% 0.10 220)",
  shelved: "oklch(60% 0.02 260)",
}

export const NOW_PLANS: Plan[] = [
  {
    id: "lsm-range-scan",
    title: "给 minilsm 加上 range scan",
    status: "active",
    addedAt: "2026-08-18",
    tags: ["rust", "storage"],
  },
  {
    id: "ts-anomaly-latent",
    title: "时间序列重构 + 异常检测的 latent idea",
    status: "active",
    addedAt: "2026-08-12",
    tags: ["time-series", "research"],
    reflection: "encoder 之后用 predictor 预测 z'，decoder 重构做异常。先跑通再写笔记。",
  },
  {
    id: "wasi-hello",
    title: "用 Rust 写一个最小的 WASI 组件",
    status: "paused",
    addedAt: "2026-08-01",
    tags: ["rust", "wasi"],
  },
  {
    id: "skill-sharing-01",
    title: "第一期 skill sharing 整理",
    status: "shelved",
    addedAt: "2026-08-05",
    tags: ["meta"],
  },
  {
    id: "yard-paper",
    title: "YARD：中间层对比解码缓解 LVLM 幻觉",
    status: "shipped",
    addedAt: "2026-08-19",
    finishedAt: "2026-08-22",
    deliverable: {
      url: "/papers/YARD",
      kind: "paper",
    },
    tags: ["lvlm", "paper-notes"],
    reflection: "第一次完整写下来的 LVLM 论文笔记，sink-shift 的动机讲清楚比想象中难。",
  },
  {
    id: "timestacker-paper",
    title: "TimeStacker：频域动机与多 patch 结构",
    status: "shipped",
    addedAt: "2026-08-10",
    finishedAt: "2026-08-13",
    deliverable: {
      url: "/papers/timestacker-motivation-and-core-flow",
      kind: "paper",
    },
    tags: ["time-series", "paper-notes"],
    reflection: "写完才发现自己之前对 patch 缺一半理解，时频分辨率那段补回来了。",
  },
  {
    id: "observer-pattern-post",
    title: "为什么 Rust 不鼓励 Observer 模式",
    status: "shipped",
    addedAt: "2026-07-28",
    finishedAt: "2026-08-02",
    deliverable: {
      url: "/blog/why-observer-pattern-is-discouraged-in-rust",
      kind: "post",
    },
    tags: ["rust"],
    reflection: "借题发挥讲了下 trait object vs dyn async 的取舍。",
  },
  {
    id: "data-oriented-design-post",
    title: "DOD 入门笔记",
    status: "shipped",
    addedAt: "2026-07-15",
    finishedAt: "2026-07-29",
    deliverable: {
      url: "/blog/data-oriented-design",
      kind: "post",
    },
    tags: ["rust", "performance"],
  },
]

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

export function formatRelative(iso: string, now = new Date()): string {
  const then = new Date(iso)
  const diffDays = Math.round((now.getTime() - then.getTime()) / 86_400_000)
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" })
  if (Math.abs(diffDays) < 30) return rtf.format(-diffDays, "day")
  return rtf.format(-Math.round(diffDays / 30), "month")
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
