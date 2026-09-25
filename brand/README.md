# Brand assets

Logo files for press, social and partners. The text in every file is converted to outlines, so they render correctly without the Bricolage Grotesque font.

| Path                                       | What                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `logo/svg/wordmark.svg`                    | Full wordmark: "studio" above the pokorama tiles, second "o" lifted      |
| `logo/svg/mark.svg`                        | App-style mark (112px grid): "poko" in a 2×2 grid, violet p and o tilted |
| `logo/svg/mark-56.svg`                     | Small mark for small sizes (no shadows)                                  |
| `logo/svg/favicon.svg`                     | Single violet "p" tile                                                   |
| `logo/png/wordmark@{1,2,4}x.png`           | Wordmark, transparent background                                         |
| `logo/png/wordmark-on-dark@{1,2,4}x.png`   | Wordmark on the brand background `#121115`, with padding                 |
| `logo/png/mark-{256,512,1024}.png`         | Mark, transparent corners                                                |
| `social/og.png`                            | 1200×630 link-preview image (also served as `/og.png`)                   |
| `source/mark.svg`, `source/mark-56.svg`    | Mark sources (live text); edit these, then regenerate                    |
| `design_handoff_studio_pokorama_brand_9b/` | Original brand handoff: rules, tokens, source SVGs (live text)           |

The logo is dark-only. Use it on `#121115` or similar dark backgrounds.

## Regenerating

Everything above (except the handoff) and the site icons in `public/` (`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `og.png`) are generated from the handoff SVGs (wordmark, favicon) and `source/` (marks):

```sh
npm run brand
```

It needs Google Chrome installed. Set `CHROME_PATH` if it isn't in the default macOS location. The tagline in the share image is set in `scripts/build-brand.mjs`.
