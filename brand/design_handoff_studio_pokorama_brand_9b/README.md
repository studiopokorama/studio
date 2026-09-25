# Handoff: Studio Pokorama — brand identity (direction 9b "Drag & drop") → website

## Overview
Studio Pokorama makes apps, games and other digital products. This package defines the chosen brand direction, **9b "Drag & drop"**. Use it as the visual foundation for the studio's website. It covers the logo, colors, type, core UI treatments and the signature interaction. It does **not** include page layouts. Build the site from these rules, and ask the user about the sitemap and content. This package replaces the earlier 8b "Tiles" handoff.

## About the design files
`brand-reference.html` is a **design reference made in HTML**, not production code. Rebuild it in the target stack. If no stack exists yet, a static-first framework such as Astro or Next.js with plain CSS or Tailwind fits well. Tokens are in `tokens.css`.

## Fidelity
**High fidelity** for the identity: colors, type, tile geometry and the logo are final. Page layout is up to the developer, as long as it follows these rules.

## The idea
"pokorama" is spelled in letter tiles on a board. **One tile, the second "o", is being dragged out of its slot**: it's lifted, tilted and violet, and a lime cursor is holding it. The slot it left shows as an **empty striped gap**. It reads like a product interface caught mid-edit: the studio is always building and moving things around.

## Logo

### Wordmark (`logo/wordmark.svg`)
- **"studio":** Bricolage Grotesque 800, 30px, line-height 1, letter-spacing −0.03em, `#9A98A0`, left-aligned above the tiles, 10px gap.
- **Tile row "pokorama":** 8 slots, 56×56px, radius 12px, 4px gap.
  - Filled tiles: `#2A2830` background, letter Bricolage Grotesque 800 34px `#EDEBE6`, centered.
  - **Slot 4 (the second "o") is empty.** It has a 2px inside stroke `#3A3842` and a hatched fill, `repeating-linear-gradient(135deg, transparent 0 6px, #1C1B21 6px 8px)`.
  - **The dragged tile** sits inside slot 4 with absolute position left 26px, top −40px. It's 56×56px, radius 12px, `#9B7BF5`, letter "o" in `#121115`, `transform: rotate(7deg)`, `box-shadow: 0 14px 24px rgba(0,0,0,.55)`, and sits above the row.
  - **Cursor:** a lime `#B8E04A` triangle, 16px wide and 18px tall, pointing up, at slot-relative left 66px and top −4px, rotated −30°, drawn above the tile.
- Always lowercase. Only one tile is ever out of its slot.

### Mark (`logo/mark.svg`, 112px)
- Container: 112×112px, radius 24px, `#1B1A1F`.
- **s** tile: 50×50px, radius 11px, `#2A2830`, at left 14px / top 48px. Letter 30px `#EDEBE6`.
- **Empty slot:** hatched area at left 66px / top 48px, 32×50px, with the right corners rounded to 11px (the part of the slot left uncovered).
- **p** tile (dragged): 48×48px, radius 11px, `#9B7BF5`, at left 54px / top 12px, rotated 8°, shadow `0 8px 14px rgba(0,0,0,.5)`. Letter 30px `#121115`.

### Small mark (`logo/mark-56.svg`)
No hatching at this size. The s tile is 25px at (7, 24) and the violet p tile is 24px at (27, 6), rotated 8°, with radius 6px.

### Favicon (`logo/favicon.svg`)
A single violet **p** tile rotated 8°, radius 7px, letter `#121115`.

### Notes on the SVGs
The SVGs use live `<text>` in Bricolage Grotesque 800. Before production, either load the font or **convert the text to outlines** in a vector tool. The shadows use `feDropShadow`.

## Signature interaction (recommended for the site)
The logo should be **actually draggable** on the website.
- **Hero:** the wordmark set large. On load, the tiles drop in one after another (40ms apart, 320ms each, `--sp-ease-back`). Then the violet "o" lifts out of slot 4 to its resting position with the cursor (400ms).
- **Drag:** pointer-down on any tile lifts it (scale 1.04, rotate 7°, the lifted shadow) and leaves a hatched slot behind. The tile follows the pointer. On release it snaps into the nearest empty slot (250ms, `--sp-ease-back`). If the word ends up spelled correctly, the violet tile goes back to its resting "mid-drag" pose.
- **Hover on cards and buttons:** a small lift, translateY(−4px) rotate(−1.5deg) with a softer version of the lifted shadow, over 180ms `--sp-ease-out`.
- **Empty and loading states:** use the hatched slot fill as a placeholder or skeleton pattern.
- **Reduced motion** (`prefers-reduced-motion`): skip the drop-in and show the resting pose.

## Design tokens
All tokens are in `tokens.css`.
- **Color:** bg `#121115`, surface `#2A2830`, surface-deep `#1B1A1F`, line `#3A3842`, stripe `#1C1B21`, text `#EDEBE6` / `#B7B5BD` / `#9A98A0`. Violet `#9B7BF5` is the "piece in play" and highlights. Lime `#B8E04A` is the cursor and primary CTAs. Text on either accent is always `#121115`. Don't use the accents for body text.
- **Type:**
  - Display: Bricolage Grotesque 800, lowercase preferred, letter-spacing −0.03 to −0.045em. Suggested sizes: 80 / 56 / 34 / 24px.
  - Body: Figtree 400/600, 15–18px, line-height 1.5.
  - Labels: JetBrains Mono 400/600, 11–13px, uppercase, +0.06em.
- **Radius:** 8 / 12 / 20 / 24 / pill.

## UI guidance
- **Buttons:**
  - Primary: lime fill, `#121115` text, Figtree 600 15px, 12×20px padding, pill-shaped.
  - Secondary: 1.5px violet outline with violet text.
- **Project cards:** `#2A2830` surface, 20px radius, with a mono label row such as "iOS · UNITY · 2026". On hover the card lifts like a dragged tile.
- **Section headers:** plain Bricolage text. Keep tiles for the logo, the hero and at most one more moment, such as the contact section, where the missing tile is the user's move.

## Files
- `brand-reference.html`: the 9b card on its own. Open it in a browser.
- `tokens.css`
- `logo/wordmark.svg`, `logo/mark.svg`, `logo/mark-56.svg`, `logo/favicon.svg`
- Source exploration: `Pokorama Pairings.dc.html`, section "Turn 9", card 9b.
