# Handoff: LockIn — Layered Paper UI

## Overview
LockIn connects to Google Classroom and shows university students only the coursework that applies to their section, when it is due, and what LockIn could not classify (Needs Review). This package contains the visual system and screens for the **layered cardboard / cut-paper** direction: public landing page, desktop app dashboard, mobile/PWA home, and loading / empty / stale / error states, in light and dark themes.

## About the Design Files
`LockIn Paper.dc.html` is a **design reference built in HTML** — a prototype that shows intended look and behavior. It is not production code to copy. Recreate these designs in the LockIn codebase's existing environment (React/Next, Vue, Svelte, etc.) using its patterns and libraries. If no frontend exists yet, a React + CSS-variables setup (or Tailwind with the tokens below registered as theme values) is the natural fit; the design is CSS-only (no images, no canvas) so it ports to any stack.

Open the HTML in a browser to inspect it. Every element is inline-styled, so devtools shows the exact values. The `Light/Dark` button in the top panel toggles theme.

## Fidelity
**High-fidelity.** Colors, type, spacing, elevation and interaction states are final. Recreate faithfully, mapping to the codebase's component library where one exists. Content (course names, assignment titles) is placeholder — wire to real Classroom data.

---

## Design principles (read first)
1. **Every surface sits on a visible sheet below it.** Elevation is expressed as stacked paper edges (hard 1–4px offset shadows in sheet colors) plus one soft ambient shadow, never a plain blur alone.
2. **Five elevation tokens, no ad-hoc shadows.** `lift-0` … `lift-4` each add one visible sheet. `press` is the recessed/pressed-in state.
3. **Contour stacking is rationed.** The offset kraft outlines behind a card ("ContourCard") appear on exactly two things: the hero copy block and Needs Review. Everything else is a single LayeredCard.
4. **Glow only lives in gaps.** The warm `glow` color appears as a blurred pool *under* a forward layer (Needs Review card, active tab underline, primary button's lower shadow) — never as a border or text color.
5. **Handwriting is annotation only** (Caveat). Never for data, labels, or actions.
6. **Corners are nearly square.** 2–5px. Never pills, except paper toggles use 2px.
7. **Red (terra) means late.** Nothing else is red.

---

## Design tokens

### Material palette — light (`[data-theme='light']`)
| Token | Value | Use |
|---|---|---|
| `--p0` Base sand | `oklch(89.5% 0.018 76)` | app background, sidebar, recessed wells |
| `--p1` Parchment | `oklch(93.5% 0.016 80)` | panels, table surfaces, inactive tabs |
| `--p2` Ivory | `oklch(96.5% 0.013 84)` | main content sheet, secondary cards |
| `--p3` Cardstock | `oklch(98.5% 0.010 88)` | cards, buttons, active tab |
| `--kraft` | `oklch(79% 0.045 68)` | primary button, contour outlines, logo tile |
| `--kraft-2` | `oklch(71% 0.052 64)` | primary button border, cloud edges |
| `--kraft-3` Board | `oklch(52% 0.060 60)` | annotations, links, dark edges |
| `--edge` | `oklch(74% 0.035 70)` | borders on secondary buttons |
| `--edge-soft` | `oklch(84% 0.024 76)` | dividers, sheet-edge shadow color |
| `--ink` | `oklch(29% 0.022 62)` | primary text |
| `--ink-soft` | `oklch(46% 0.024 62)` | body / secondary text |
| `--ink-faint` | `oklch(48% 0.028 64)` | captions, mono metadata |
| `--glow` | `oklch(90% 0.095 80)` | backlight pools, active underline |
| `--glow-deep` | `oklch(82% 0.120 72)` | Due-today marker, stale marker, button under-glow |
| `--terra` | `oklch(53% 0.135 42)` | Late / error |
| `--moss` | `oklch(52% 0.075 138)` | synced / done / tracked |
| `--slate` | `oklch(48% 0.030 250)` | Needs Review |

### Material palette — dark (`[data-theme='dark']`)
Dark is not an inversion; sheets get darker as they go *down*, and highlights come from a 1px inner top light.
| Token | Value |
|---|---|
| `--p0` | `oklch(19.5% 0.013 66)` |
| `--p1` | `oklch(23.5% 0.015 68)` |
| `--p2` | `oklch(27.5% 0.016 70)` |
| `--p3` | `oklch(32% 0.017 72)` |
| `--kraft` | `oklch(45% 0.048 62)` |
| `--kraft-2` | `oklch(53% 0.055 60)` |
| `--kraft-3` | `oklch(76% 0.060 68)` |
| `--edge` | `oklch(40% 0.022 70)` |
| `--edge-soft` | `oklch(44% 0.024 72)` |
| `--ink` | `oklch(95% 0.012 82)` |
| `--ink-soft` | `oklch(79% 0.016 78)` |
| `--ink-faint` | `oklch(72% 0.018 74)` |
| `--glow` | `oklch(80% 0.110 78)` |
| `--glow-deep` | `oklch(74% 0.130 70)` |
| `--terra` | `oklch(73% 0.150 40)` |
| `--moss` | `oklch(71% 0.090 140)` |
| `--slate` | `oklch(74% 0.065 250)` |

### Elevation (light)
```css
--lift-0: 0 1px 0 var(--edge-soft);
--lift-1: 0 1px 0 var(--edge-soft), 0 2px 3px -1px oklch(58% 0.05 62 / 0.16);
--lift-2: 0 1px 0 var(--edge-soft), 0 2px 0 var(--p1), 0 4px 8px -3px oklch(56% 0.05 62 / 0.22), 0 10px 18px -12px oklch(52% 0.05 62 / 0.26);
--lift-3: 0 1px 0 var(--edge-soft), 0 3px 0 var(--p1), 0 5px 0 var(--edge-soft), 0 9px 16px -6px oklch(54% 0.05 62 / 0.26), 0 20px 34px -18px oklch(50% 0.05 62 / 0.32);
--lift-4: 0 1px 0 var(--edge-soft), 0 4px 0 var(--p2), 0 6px 0 var(--edge-soft), 0 8px 0 var(--p1), 0 10px 0 var(--edge-soft), 0 16px 26px -8px oklch(52% 0.05 62 / 0.28), 0 34px 50px -24px oklch(48% 0.05 62 / 0.34);
--press: inset 0 2px 4px oklch(56% 0.05 62 / 0.28), inset 0 -1px 0 oklch(100% 0 0 / 0.5);
```
### Elevation (dark)
```css
--lift-0: inset 0 1px 0 oklch(100% 0 0 / 0.05), 0 1px 2px oklch(6% 0.01 60 / 0.5);
--lift-1: inset 0 1px 0 oklch(100% 0 0 / 0.06), 0 2px 4px -1px oklch(5% 0.01 60 / 0.6);
--lift-2: inset 0 1px 0 oklch(100% 0 0 / 0.07), 0 2px 0 var(--p1), 0 3px 0 oklch(100% 0 0 / 0.05), 0 6px 12px -4px oklch(4% 0.01 60 / 0.65);
--lift-3: inset 0 1px 0 oklch(100% 0 0 / 0.09), 0 3px 0 var(--p1), 0 4px 0 oklch(100% 0 0 / 0.06), 0 6px 0 var(--p0), 0 12px 22px -6px oklch(4% 0.01 60 / 0.7);
--lift-4: inset 0 1px 0 oklch(100% 0 0 / 0.1), 0 4px 0 var(--p2), 0 5px 0 oklch(100% 0 0 / 0.07), 0 8px 0 var(--p1), 0 9px 0 oklch(100% 0 0 / 0.05), 0 20px 34px -10px oklch(3% 0.01 60 / 0.75);
--press: inset 0 2px 5px oklch(4% 0.01 60 / 0.7), inset 0 -1px 0 oklch(100% 0 0 / 0.05);
```
Usage: `lift-0` list rows / inactive nav · `lift-1` secondary buttons, table cards · `lift-2` primary buttons, assignment cards, active nav · `lift-3` hero copy block, Needs Review, main content sheet · `lift-4` device frame / page frame only.

### Paper grain (both themes)
Two crossed 1px repeating-linear-gradients at 31° and −59°, alpha 0.035–0.045 (light) / 0.022–0.05 (dark). Applied as `background-image` on `p0`, `p2` sheets and the hero card. Keep it barely visible.

### Typography
- **Instrument Sans** (400/500/600/700) — all UI.
- **IBM Plex Mono** (400/500) — times, dates, counts, section captions. Always `font-variant-numeric: tabular-nums`.
- **Caveat** (500/600) — annotations only.

| Role | Size / weight / tracking |
|---|---|
| Display (landing) | 42px / 700 / −0.04em / lh 1.03 |
| Section title (landing) | 34px / 700 / −0.035em / lh 1.06 |
| Page title (app) | 27px / 700 / −0.035em |
| Card title | 16px / 700 / −0.02em |
| Assignment title | 14.5px / 600 / −0.012em |
| Body | 14.5px / 400 / lh 1.65 (landing), 13.5px / lh 1.55 (app) |
| Secondary | 12–12.5px / 400 / `--ink-soft` or `--ink-faint` |
| Caption | Mono 10–10.5px / 500 / 0.14em tracking / uppercase |
| Time / due | Mono 13.5px / 500 |
| Annotation | Caveat 17–20px / `--kraft-3` / rotate −4° to +3° |

### Spacing & radius
- Spacing scale: 3, 6, 9, 12, 16, 18, 22, 26, 34, 44, 60.
- Radius: 2px tags/badges/toggles · 3px buttons, cards, nav items · 4–5px page frames · 16–22px only for the phone bezel.
- Touch targets ≥ 44px on mobile; desktop buttons 38–48px.

### Motion
- Button hover: `translateY(-2px)`, shadow steps up one lift; 160ms ease.
- Button press: `translateY(2px)`, shadow → `--press`.
- Card hover (desktop assignment): `translateY(-3px)`, lift-1 → lift-3; 200ms cubic-bezier(0.22,1,0.36,1).
- Sidebar nav hover: `translateX(3px)`, lift-0 → lift-1; 180ms.
- Sheet stack-in (`pp-stack`): opacity 0→1, `translateY(10px) scale(0.985)` → none; 520–700ms, staggered 60–110ms per row.
- Skeleton shimmer 1.6s linear; hero backlight breathes 12s (opacity 0.55–0.95).
- Respect `prefers-reduced-motion` — collapse all durations.

---

## Components

**PaperSurface** — any `p0–p3` sheet, optional grain. Props: `tone`, `lift`, `grain`.

**LayeredCard** — `p3` card, radius 3, `lift-1/2`. Optional left status bar (4–5px, colored by semantic token). Hover raises one lift.

**ContourCard** — LayeredCard with 2–3 absolutely positioned offset sheets behind it (`inset: 6px -6px -7px -4px` parchment, `inset: 11px -12px -12px -8px` kraft @40%, `inset: 16px -18px -18px -12px` kraft @26%) and an optional glow pool above (`inset: -6px 4px 20px 4px; blur 12px; opacity .55`). Only for hero copy + Needs Review.

**PaperButton** — variants `primary` (kraft bg, kraft-2 border, 700, lift-2 + under-glow `0 12px 22px -12px var(--glow-deep)`), `secondary` (p2/p3 bg, edge border, 600, lift-1), `quiet` (transparent, ink-soft). Heights 40/44/48.

**PaperTab** — clipped top-right corner `clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)`, radius `3px 3px 0 0`. Active: `p3`, lift-2, `translateY(-3px)`, 3px `--glow` strip at bottom. Inactive: `p1`, lift-0, ink-soft.

**PaperNavigation (desktop)** — 214px sidebar on `p0` with inset right shadow. Items 44px, radius `3px 0 0 3px`. Active item is a `p3` sheet pushed 3px right with glow strip beneath; it visually joins the content sheet.

**PaperNavigation (mobile)** — bottom bar of 4 PaperTabs on `p0`, safe-area padding 20px bottom.

**PaperBadge** — 2px radius, `p1` bg + lift-0 for states ("Draft saved"); `slate` bg + `p3` text for the Review count.

**CutoutIcon** — 40px `p1` square with `--press`, 19px line icon (1.7–1.8 stroke, round caps) in ink-soft.

**RecessedWell** — `p1` or `p0` with `--press`; used for evidence lists, stream previews, empty states, privacy cards.

**PaperToggle** — 36×22, 2px radius, track `--press`; on = kraft track, knob right; off = `p1` track, knob left. Knob 16px `p3` + lift-1.

**SyncPill** — 38px, `p3`, lift-1, 7px square dot (moss / slate / glow-deep / terra) + "Updated 4m ago".

**Annotation** — Caveat label on a small `p3` sheet with lift-2, rotated 2–4°.

**CurlCloud (landing hero only)** — nested concentric discs: edge ring (kraft) → sheet disc → inner edge → inner disc + curl tail arc + side puff. Three depth rows; sizes 44–200px; sits on a sheet ground line. Pure CSS; see hero in HTML.

### Semantic colors
| Meaning | Token | Where |
|---|---|---|
| Late / error | `--terra` | 4px top bar or 5px left bar, mono label |
| Due today | `--glow-deep` | left bar on assignment rows |
| Stale / partial sync | `--glow-deep` | left bar, sync dot |
| Needs review | `--slate` | caption, badge |
| Synced / done / tracked | `--moss` | dots, course bars |
| This week / later | `--edge` | left bar; text in ink-soft |

---

## Screens

### 1. Landing page (1280, scrolls)
Sticky header: logo tile (30px kraft square, lock mark) + "LockIn" 16/700; center PaperTabs Overview / How it works / Privacy; right "Sign in" (secondary 40) + "Get started" (primary 40).

Hero (620px shadow-box, `--press` well, gradient p3→p2→p1): breathing glow ellipse 720×320 at 50%/40%; four layered cloud ovals top; **CurlCloud** banks along the bottom in 3 rows. Left ContourCard (520px, at 56/76): eyebrow chip "GOOGLE CLASSROOM, FILTERED", display headline "See only the coursework that applies to your section.", body, CTAs "Continue with Google" (primary 48) + "How filtering works" (secondary 48). Right: 400px "Your week" preview card (LayeredCard lift-3 with two backing sheets), rows with left bars, footer strip "3 items need your call", annotation "your section only".

Sections (alternating p1 / p2 sheets, 60px side padding, joined by a scalloped cut-paper seam):
- **01 Problem** — copy left (420px) / recessed "Classroom stream, unsorted" well right; rows that are yours sit forward (p3, lift-2, +6px), others recede (p1, 60% opacity). Annotation "only 3 of these are yours".
- **02 Filtering** — kept list on ContourCard + "Set aside" pressed stack left / copy right with 6-segment ratio bar (glow-deep ×3, slate ×1, edge ×2) and mono caption.
- **03 Needs Review** — copy left / full Needs Review ContourCard right (480px).
- **04 Courses / 05 Freshness** — two columns. Course rows with PaperToggle; archived/unavailable rows use `--press` and ink-soft. Sync states as four SyncPill rows.
- **06 Privacy** — three RecessedWell cards: Read-only access · Coursework only · Disconnect anytime.
- **CTA** — p0 well containing a p2 sheet (lift-3) with glow pool and two small cut ridges at the base; headline "Your Classroom, filtered for your section.", primary + "Read the privacy note".
- Footer: logo · Privacy / Terms / Contact · annotation "not affiliated with Google".

### 2. Desktop app — Today (1280)
Sidebar 214px (`p0`) → main sheet (`p2`, grain, lift-2, padding 26/28/32).
Header: "Today" 27/700 + mono date line; right: SyncPill + "Sync now" (secondary 38).
Grid `1fr 336px`, gap 26.
- Main column: **Late** card (LayeredCard with 2 backing sheets, 4px terra top bar, grid `1fr 132px 128px 108px`); **Due today** section (mono caption + rule + count) with 3 assignment rows `5px 1fr 132px 128px 24px`, min-height 66, left bar glow-deep, state badge, chevron; **This week** as a single `p1` table (rows 54px, hover → p2).
- Right column: **Needs Review** ContourCard (glow pool, evidence RecessedWell, "This is for me" primary 44 + "Not for me" secondary 44, annotation "contour card"); **Tracked** card with course rows and a stale notice well ("Course E is 3 hours behind").
Sidebar bottom: sync summary card (6 segment bar) and account row.

### 3. Mobile / PWA — Today (390×812)
Phone bezel `p1` 22px radius, lift-4; screen `p2` 16px radius with `--press`. Status bar 40px mono. Header: logo tile, "Today" 20/700 + mono subline, 44px avatar tile. Scroll area: Late card (5px terra left bar, one backing sheet) → "Due today" caption → 3 tactile cards (lift-2, 15/16 padding, press feedback → translateY(2px), lift-0) → Needs Review card (glow pool, "For me"/"Not for me" 44px). Bottom PaperNavigation: Today (active, raised, glow strip) · Upcoming · Courses · Review (slate count badge).

### 4. States
- **Loading** — 3 skeleton sheets stack in (pp-stack, 110ms stagger); title line shimmers.
- **Empty** — RecessedWell, three small sheet chips, "You're all caught up." 16/700, "Nothing due for Section 02 right now.", secondary button "See this week".
- **Stale** — LayeredCard, 5px glow-deep left bar, "Showing data from 3 hours ago", body, "Try again" secondary + "Dismiss" quiet.
- **Error** — LayeredCard, 5px terra left bar, "Google Classroom needs reconnecting", body, "Reconnect" primary + "What breaks?" secondary.
- Sync copy set: Updating Classroom · Updated 2 min ago · Some courses couldn't sync · Showing data from 3 hours ago · Google Classroom needs reconnecting.

---

## Interactions & behavior
- Theme: `data-theme="light|dark"` on root; persist user choice; default to `prefers-color-scheme`.
- Needs Review: "This is for me" moves item into the Due lists and records the decision per course; "Not for me" recesses it into Set aside. Never show classifier confidence numbers — only the three plain-language evidence lines.
- Course toggles: tracked on/off; archived/unavailable rows show status but remain toggleable where the API allows.
- Sync: show relative time; if last successful fetch > 1h, switch SyncPill dot to glow-deep and surface the Stale card. Never present stale data as current.
- Keyboard: all buttons/rows focusable; focus ring `0 0 0 2px var(--p3), 0 0 0 4px var(--kraft-3)`.
- Mobile: bottom nav respects `env(safe-area-inset-bottom)`; cards give press feedback; sheets (bottom sheets) slide up as a new paper layer with lift-4.

## State
`theme`, `courses[] {id, name, section, tracked, status: tracked|archived|unavailable|syncIssue}`, `assignments[] {id, title, courseId, due, submissionState, relevance: mine|review|aside, decision?}`, `sync {status, lastSuccess, failingCourseIds[]}`, `reviewQueue[]`.

## Assets
No raster assets. Logo is an inline SVG "L" mark (`M9 6h13v39h28v13H9z` + `rect 30,6 13×26` in a 64 viewBox). Icons: 24-viewBox line icons, 1.7–1.8 stroke, round caps (home, calendar, book, help-circle, settings, chevron-right). Fonts from Google Fonts: Instrument Sans, IBM Plex Mono, Caveat.

## Files
- `LockIn Paper.dc.html` — the full design reference (all screens, both themes). Open in a browser; toggle theme with the top-right button.
- `support.js` — runtime required by the HTML file to render. Not part of the deliverable.
