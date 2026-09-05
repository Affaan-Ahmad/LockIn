# LockIn design system

## Direction

Modern-minimal with restrained dimensional surfaces. Preserve the existing lime, near-black and porcelain brand and self-hosted Geist. Student coursework, not enterprise analytics, determines the layout.

## Structure families

- App: Workbench. Persistent desktop sidebar, quiet utility header, assignment workspace and optional context rail. One content tree at every viewport.
- Marketing: product walkthrough. Split headline and clearly labeled illustrative coursework; concrete shared-Classroom explanation; privacy; direct sign-in CTA.
- Legal: reading document. Preserve route ownership and legal content.

## Typography and motion

Geist for display and body, weights 400/500/600. Existing semantic Tailwind type scale; display typography only on public pages. Tabular deadline figures. No entry reveals or decorative animations. Press uses transform; overlays use opacity/transform with reduced-motion support.

## Tokens and density

`src/app/globals.css` owns existing light/dark color values and Tailwind/shadcn aliases. `tokens.css` adds portable role aliases and 4px spacing, density, layout and motion tokens. `src/app/workspace.css` composes them. Do not introduce independent page palettes.

Phone: 16px gutters, 44px controls, 16px card corners, modest clay depth. Tablet at 768px: 64px icon sidebar, medium-density rows. Desktop at 1024px: 208px labeled sidebar. Context rail at 1280px: 288px, leaving title/deadline space. Maximum workspace width 1536px. Fine-pointer desktop controls may reduce to 36px; tablets retain touch targets.

## Semantics

Freshness and latest run status are separate backend facts. Failed/partial/running status must never be erased by a recent successful timestamp. Unavailable does not necessarily mean disconnected. Missing due dates and unknown submission state remain explicit. Course freshness is not fabricated. Review explanations describe supplied scope evidence, never implement classification.

## Signature and interaction

Small open focus bracket, used for active navigation and deadline grouping. No decorative charts, colored course tiles or large repeated pill surfaces. Native links and buttons stay distinct; visible focus is instant. Settings use anchors with scroll margins, phone review decisions remain within their assignment.

## Exports

The authoritative CSS export is `tokens.css` together with the palette in `src/app/globals.css`; these aliases follow both themes:

```css
:root {
  --color-paper: var(--surface-ground);
  --color-paper-2: var(--surface-raised);
  --color-ink: var(--ink);
  --color-rule: var(--line);
  --color-focus: var(--brand-ring);
  --font-display: var(--font-geist-sans), sans-serif;
  --font-body: var(--font-geist-sans), sans-serif;
}
```

Tailwind v4 and shadcn already consume the shared palette through the existing `@theme inline` block in `globals.css`; preserve it. Equivalent portable aliases:

```css
@theme inline {
  --color-background: var(--surface-ground);
  --color-foreground: var(--ink);
  --color-primary: var(--brand);
  --color-primary-foreground: var(--ink-on-brand);
  --color-ring: var(--brand-ring);
}
:root {
  --background: var(--surface-ground);
  --foreground: var(--ink);
  --primary: var(--brand);
  --primary-foreground: var(--ink-on-brand);
  --ring: var(--brand-ring);
}
```

Minimal DTCG light-theme interchange example (not a second runtime source):

```json
{
  "color": {
    "paper": { "$type": "color", "$value": "oklch(96.6% 0.007 107)" },
    "ink": { "$type": "color", "$value": "oklch(22% 0.010 145)" },
    "brand": { "$type": "color", "$value": "oklch(17.9% 0.005 145)" }
  },
  "space": { "gutter": { "$type": "dimension", "$value": "1rem" } }
}
```
