# Frontend audit — 5 September 2026

## Before implementation

The repository already attempts distinct phone and desktop layouts. The problem is implementation and composition, not a complete absence of responsive styles.

| Finding | Evidence | Planned correction |
| --- | --- | --- |
| Entire screen rendered twice | `AppShell.tsx` places `children`, `rail`, and `headerAside` in both hidden/visible shells | One server-rendered main, header, context area and footer; only navigation has separate presentations |
| Assignment content duplicated again | `AssignmentCard.tsx` renders two copies of titles, deadlines, badges and actions | One semantic assignment tree; CSS grid areas define phone card and desktop row |
| Excess hydration and duplicate IDs | Both shell copies mount forms, theme controls, sync effects, dialogs; group headings repeat IDs | Remove duplicate trees, retain small existing client islands |
| Dense rows are cramped rather than efficient | Twelve-column row assigns only two columns to several badges and actions; course takes precedence over title | Flexible title/course identity, stable deadline column, wrapping status and explicit detail link |
| Desktop rhythm still resembles separated cards | Each assignment has its own full border, radius, lift and 12px gap | Grouped, divider-separated rows with flat desktop surfaces |
| Course grid lacks scan alignment | Always two equal cards at pointer density, no explicit tracked status | Aligned course rows with section and explicit saved/pending tracking state |
| Settings composition is arbitrary | Two-column layout mixes short account block, wide form and destructive settings | Subsection navigation and one coherent configuration column |
| Review decisions detached from evidence | Card followed by separate controls, unclear consequences | One review unit; source scope context and explicit decision explanations |
| Sync copy overclaims | `SyncStatus` conflates unavailable with disconnected, stale with failed; domain freshness can be FRESH after a failed recent attempt | Pass through latest backend run status and connection usability; independently present that status without altering freshness rules |
| Review badge does not match queue | `loadReviewCount` and dashboard count only upcoming uncertain assignments | Reuse the authoritative review queue, including overdue and undated items |
| Overconfident empty copy | Dashboard says caught up with no qualification for review, missing dates, stale data or query limits | Say no dated work in this view; disclose review and sync context |
| Missing-date work disappears from grouping | `GROUP_ORDER` excludes `none`; main dashboard does not request undated work | Render a separate undated section from existing backend feed |
| Touch sizes inconsistent | Small buttons 36px, detail close 32px, review undo 36px | Shared 44px touch minimum, smaller controls only for fine pointers |
| Nested interactive elements | Links wrap `Button` in app, marketing and detail | Shared styled link primitive; no button inside anchor |
| Mobile safe-area top absent | App header only uses `pt-6` | Header and gutters incorporate safe areas; preserve bottom navigation inset |
| Dialog can exceed phone viewport | Centered dialog has no max-height/overflow | Scrollable mobile sheet geometry; retain Radix focus/escape handling |
| Token inconsistencies | Spacing steps 18/28/44px despite stated 4pt scale; density tokens do not control most buttons; duplicated dark declaration | Semantic density tokens and coherent scale, retain existing brand/theme mappings |
| Unnecessary motion | `.lift` transitions blurred shadows on assignment hover | Static row highlight and transform-only press feedback |
| Marketing repeats identical rhythm | Intro plus two identical three-column feature sections, little product demonstration | Product-oriented split hero and concrete shared-Classroom example, varied explanation/privacy sections |

## Foundation to preserve

`src/lib/queries.ts`, domain services, auth, RLS, sync correctness, section classification, overrides and deadline normalization remain authoritative. Changes to query adapters only expose existing results. Keep Geist self-hosting, native inputs, Radix dialogs, URL-based calendar/detail selection, semantic palette, custom icon set, legal copy and OAuth links.

Shared: assignment title/course/deadline/status primitives, formatters, presentation maps, query loaders, buttons/links, surfaces, skeletons and theme tokens. Distinct presentation: desktop sidebar and utility frame; mobile bottom navigation/header; responsive assignment/course layouts; review decision composition; settings subsection layout.

No viewport JavaScript is necessary. Existing client components mostly have valid reasons (mutation, browser installation state, pathname, local controls); removing duplicated mounts matters more than relabeling interactive forms as server components. No evidence yet justifies deleting standalone production files. Obsolete duplicated branches and unused imports can be removed in place.

## Constraints requiring honest limits

The course view adapter does not currently expose per-course sync results. Do not infer a course failure from aggregate freshness. Query limits mean workload counts describe the loaded view, not a guaranteed full account total. Live authenticated QA requires a user session; isolated fixture rendering can verify presentation but not Google/Supabase integration. PWA display mode and safe areas can be simulated; real installation needs a device check.
