# Now Page — Design Spec

**Date:** 2026-08-22
**Status:** Approved
**Route:** `/now`

## Purpose

A single, low-friction page that shows what the author is working on, paused on, has shipped, or has shelved. The page is curated by hand from a typed data file. There are no per-plan detail pages; everything lives on `/now`.

The page borrows the Derek Sivers "now page" convention so visitors (and the author) can see current focus at a glance, without subscribing to a feed.

## Scope

In scope:

- One Astro page at `/now`
- One typed data file at `src/data/now.ts` with a list of plan items
- One nav entry in `src/consts.ts`
- Page styles following the existing design language

Out of scope (deliberately deferred):

- Per-plan detail pages or RSS feed for the Now section
- A content collection (one markdown file per plan) — items are too short
- Filter bar / tabs — section grouping by status is sufficient
- Editorial hero line / "Recently shipped" top strip — explicitly dropped from the original proposal to keep the page minimal

## Data model

`src/data/now.ts` exports a typed list. The page imports it directly.

```ts
export type PlanStatus = "active" | "paused" | "shipped" | "shelved"

export type DeliverableKind = "post" | "paper" | "project" | "external"

export interface Deliverable {
  url: string
  kind: DeliverableKind
}

export interface Plan {
  id: string                  // url-safe slug; not used for routing, only for keys and stable diffs
  title: string               // required
  status: PlanStatus
  addedAt: string             // ISO date, e.g. "2026-08-15"
  finishedAt?: string         // ISO date; required when status === "shipped"
  deliverable?: Deliverable   // optional; usually paired with "shipped"
  reflection?: string         // 1–2 sentences; usually paired with "shipped"
  tags?: string[]             // optional free-form category pills
}

export const NOW_PLANS: Plan[] = [
  // example entries — actual content authored separately
]
```

Conventions (enforced by code review, not at runtime):

- `finishedAt` is required when `status === "shipped"`.
- `status === "shelved"` items should normally have neither `deliverable` nor `reflection`.
- Items within a section sort by `addedAt` descending (newest first); shipped items additionally support an "ended recently" sort within their section.

## Page layout

The page is composed of one header and four sections, in this fixed order:

1. Header (`<header>` with `<h1>Now</h1>`)
2. Active
3. Paused
4. Shipped
5. Shelved

Empty sections are still rendered with a muted one-line empty state (e.g. "没有进行中的项目。") rather than being hidden — that way the structure is stable over time and visitors can see all four status buckets exist.

### Header

```astro
<header>
  <h1>Now</h1>
  <p>近期在做的、暂停的、已经完成的，以及暂时放下的。</p>
</header>
```

Mirrors the `header` block at `src/pages/papers/index.astro:16-19` and `src/pages/blog/index.astro` — `<h1>` + one muted subtitle paragraph using `--step-3` and `--muted-foreground`. No editorial "currentFocus" line.

### Section structure

Each section uses real `<section aria-labelledby="now-{status}">` with a `<h2 id="now-{status}">{Label} <sup>{count}</sup></h2>` header.

```astro
<section aria-labelledby="now-active">
  <h2 id="now-active">进行中 <sup>{active.length}</sup></h2>
  <ol>
    {active.map((plan) => <PlanCard plan={plan} />)}
  </ol>
  {active.length === 0 && <empty-line>没有进行中的项目。</empty-line>}
</section>
```

`PlanCard.astro` is a new component (see Component section). Each section is its own `<section>` rather than a flat `<ul>` so screen readers can navigate by status.

### Plan card

The card reuses the rail-dot pattern from `src/pages/daily/index.astro:188-237` (`<daily-day>` → `<day-marker>` → `<day-dot>`), but oriented as a left-rail column on each item.

Visual anatomy:

```
┌─────────────────────────────────────────┐
│ ●  Title                       added 12d │
│    一句 reflection（如果有）             │
│    → /blog/foo  #rust  #wasi            │
└─────────────────────────────────────────┘
```

Component sketch:

```astro
---
import { formatRelative } from "@/lib/now"
import { STATUS_ACCENT } from "@/data/now"
const { plan } = Astro.props
const dotColor = STATUS_ACCENT[plan.status]
const dateField = plan.status === "shipped" && plan.finishedAt
  ? `finished ${formatRelative(plan.finishedAt)}`
  : `added ${formatRelative(plan.addedAt)}`
---

<li data-status={plan.status}>
  <plan-rail>
    <plan-dot style={`--accent: ${dotColor}`} aria-hidden="true" />
  </plan-rail>
  <plan-body>
    <plan-title>
      <span>{plan.title}</span>
      {plan.deliverable && (
        <plan-deliverable>
          → <a
            href={plan.deliverable.url}
            target={plan.deliverable.kind === "external" ? "_blank" : undefined}
            rel="noopener noreferrer"
          >{shortenUrl(plan.deliverable.url)}</a>
        </plan-deliverable>
      )}
    </plan-title>
    <plan-meta>
      <plan-date>{dateField}</plan-date>
      {plan.tags && plan.tags.map((t) => <span>#{t}</span>)}
    </plan-meta>
    {plan.reflection && <plan-reflection>{plan.reflection}</plan-reflection>}
  </plan-body>
</li>
```

Title is always a `<span>` — the deliverable pill is the only link, so cards without a deliverable stay non-clickable and there is no nested-link ambiguity.

## Status colors

```ts
// src/data/now.ts (or extracted to src/lib/now.ts)
export const STATUS_ACCENT: Record<PlanStatus, string> = {
  active:   "oklch(68% 0.15 145)",  // green
  paused:   "oklch(75% 0.13 75)",   // amber
  shipped:  "oklch(65% 0.10 220)",  // muted teal-blue
  shelved:  "oklch(60% 0.02 260)",  // desaturated gray
}

export const STATUS_LABEL: Record<PlanStatus, string> = {
  active:   "进行中",
  paused:   "已暂停",
  shipped:  "已完成",
  shelved:  "已搁置",
}
```

The exact oklch values are placeholders; the author can tune them in a single place. The dot uses `border-color: var(--accent); background: var(--background)` so it reads as a ring rather than a filled circle in light mode (matches daily's `<day-dot>`).

## Animations

Reuse the stagger pattern from `src/pages/daily/index.astro:352-364`:

```css
@media (prefers-reduced-motion: no-preference) {
  [data-status] {
    animation: rise-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: calc(var(--stagger, 0) * 50ms);
  }
}
```

`--stagger` is set inline as `Math.min(indexWithinSection, 8)` so the animation doesn't slow down long sections.

## Component breakdown

Four new files:

- `src/data/now.ts` — typed data + status maps. Single source of truth for status colors and labels.
- `src/lib/now.ts` — pure helpers: `formatRelative(iso)`, `groupByStatus(plans)`, `sortByDate(plans)`, `validatePlans(plans)` (warns at build time if a shipped plan is missing `finishedAt`).
- `src/components/PlanCard.astro` — renders one plan.
- `src/pages/now.astro` — the page itself.

One existing file touched:

- `src/consts.ts` — add `{ href: "/now", label: "Now" }` to `NAVIGATION`.

Files explicitly **not** touched: `astro.config.ts` (sitemap filter is fine for `/now`), `src/content.config.ts` (not a content collection).

## Edge cases

- **All four sections empty** — page still renders with four one-line empty states plus the header. No special "first run" view.
- **`finishedAt` missing on a Shipped item** — `validatePlans()` in `src/lib/now.ts` logs a `console.warn` during build (Astro surfaces these) but does not block the build. Run from the page's frontmatter so it executes at build time.
- **Long titles / long reflections** — wrap naturally; no truncation.
- **External deliverable URLs** (`kind: "external"`) — render with `target="_blank" rel="noopener noreferrer"`.
- **Internal deliverable URLs** (`post` / `paper` / `project`) — render without `target="_blank"`; rely on in-page navigation.
- **Plan title link wrapping** — pill sits inline with the title; if the title is long, the pill wraps to a new line on small screens.

## Accessibility

- Sections use `<section aria-labelledby>` so screen readers can jump by status.
- Status counts live in `<sup>` inside the `<h2>` (mirrors daily's filter pills).
- The status dot is `aria-hidden="true"` — it's decorative; the status is communicated by the section header.
- No nested links: cards with a deliverable wrap only the title in `<a>`; meta and tags remain siblings.
- The relative date (`added 12d`) is plain text — no `<time>` wrapper needed since precision is fuzzy.

## Responsive

- Desktop: rail-dot left column, body fills the rest (same grid template as daily).
- `<40rem`: rail and dot hidden; card collapses to single column (matches `src/pages/daily/index.astro:366-380`).
- Tags and deliverable pill wrap naturally inside `<plan-meta>` (`flex-wrap: wrap; gap: var(--space-2xs)`).

## Testing & verification

- `npx astro check` must pass (0 errors, no new warnings).
- `npx astro build` must complete and produce a `/now/index.html`.
- Manual visual check at three breakpoints (`>64rem`, `40–64rem`, `<40rem`).
- Manual keyboard navigation: tabbing through deliverable links only — no focus traps.

## Rollout

- Implementation in one PR.
- Seed data file with ~6–10 example plans covering all four statuses so the page is meaningful on first deploy.
- No migration, no RSS, no content collection.
