// Builds the media kit (brand/logo, brand/social) and the site icons (public/) from the source SVGs:
// the wordmark and favicon come from the handoff, the "poko" marks from brand/source.
// Text is converted to outlines so the files render the same everywhere, with or without the font.
// Usage: npm run brand   (needs Google Chrome; override its path with CHROME_PATH)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const handoff = path.join(
  root,
  "brand/design_handoff_studio_pokorama_brand_9b/logo",
);
const out = {
  svg: path.join(root, "brand/logo/svg"),
  png: path.join(root, "brand/logo/png"),
  social: path.join(root, "brand/social"),
  public: path.join(root, "public"),
};
const fontFile = (pkg, file) =>
  path.join(root, "node_modules/@fontsource", pkg, "files", file);
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const BG = "#121115";
const DEEP = "#1B1A1F";
const TAGLINE = ["Apps, games and media.", "Building piece by piece."];

// ─── SVG: text → outlines ─────────────────────────────────────

const display = opentype.parse(
  (
    await readFile(
      fontFile(
        "bricolage-grotesque",
        "bricolage-grotesque-latin-800-normal.woff",
      ),
    )
  ).buffer,
);

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

function outlineText(svg) {
  return svg.replace(/<text\b([^>]*)>([^<]*)<\/text>/g, (_, attrs, text) => {
    const x = Number(attr(attrs, "x"));
    const y = Number(attr(attrs, "y"));
    const size = Number(attr(attrs, "font-size"));
    const fill = attr(attrs, "fill");
    const spacingPx = Number(attr(attrs, "letter-spacing") ?? 0);
    if (![x, y, size].every(Number.isFinite) || !fill)
      throw new Error(`unsupported <text${attrs}>`);
    // Glyphs are placed by hand (advance + kerning): opentype.js can't run some of this font's GSUB lookups,
    // and lowercase Latin text needs no substitutions.
    const scale = size / display.unitsPerEm;
    const glyphs = [...text].map((ch) => {
      if (!display.hasChar(ch))
        throw new Error(`font has no glyph for "${ch}"`);
      return display.charToGlyph(ch);
    });
    const advances = glyphs.map((g, i) => {
      const kern =
        i + 1 < glyphs.length ? display.getKerningValue(g, glyphs[i + 1]) : 0;
      return (
        (g.advanceWidth + kern) * scale +
        (i + 1 < glyphs.length ? spacingPx : 0)
      );
    });
    const width = advances.reduce((a, b) => a + b, 0);
    let pen = attr(attrs, "text-anchor") === "middle" ? x - width / 2 : x;
    // dominant-baseline="central": y is the middle of the em box, between ascender and descender.
    const base =
      attr(attrs, "dominant-baseline") === "central"
        ? y + ((display.ascender + display.descender) / 2) * scale
        : y;
    const d = glyphs
      .map((g, i) => {
        const part = g.getPath(pen, base, size).toPathData(2);
        pen += advances[i];
        return part;
      })
      .join("");
    return `<path d="${d}" fill="${fill}"/>`;
  });
}

const stripMetadata = (svg) =>
  svg
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
    .replace(/\s+xmlns:c2pa="[^"]*"/g, "");

await Promise.all(
  Object.values(out).map((dir) => mkdir(dir, { recursive: true })),
);

const LOGOS = ["wordmark", "mark", "mark-56", "favicon"];
const svgs = {};
for (const name of LOGOS) {
  const dir = name.startsWith("mark")
    ? path.join(root, "brand/source")
    : handoff;
  const src = await readFile(path.join(dir, `${name}.svg`), "utf8");
  svgs[name] = outlineText(stripMetadata(src));
  if (svgs[name].includes("<text"))
    throw new Error(`${name}.svg still contains text`);
  await writeFile(path.join(out.svg, `${name}.svg`), svgs[name]);
}
await writeFile(path.join(out.public, "favicon.svg"), svgs.favicon);

// ─── raster: render in Chrome ─────────────────────────────────

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
});
const page = await browser.newPage();
const dataUri = (svg) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/** Render an SVG at `scale` into a PNG of size w×h (defaults to the SVG's own size), optionally on a background. */
async function renderSvg(
  svg,
  file,
  { scale = 1, background = null, pad = 0, size = null } = {},
) {
  const w = Number(attr(svg, "width"));
  const h = Number(attr(svg, "height"));
  const box = size ?? { w: w * scale + pad * 2, h: h * scale + pad * 2 };
  await page.setViewport({
    width: Math.round(box.w),
    height: Math.round(box.h),
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><body style="margin:0;display:grid;place-items:center;width:${box.w}px;height:${box.h}px;background:${background ?? "transparent"}">` +
      `<img src="${dataUri(svg)}" width="${w * scale}" height="${h * scale}"></body></html>`,
  );
  await page.evaluate(() => document.images[0].decode());
  return page.screenshot({
    path: file,
    omitBackground: !background,
    type: "png",
  });
}

for (const s of [1, 2, 4]) {
  await renderSvg(svgs.wordmark, path.join(out.png, `wordmark@${s}x.png`), {
    scale: s,
  });
  await renderSvg(
    svgs.wordmark,
    path.join(out.png, `wordmark-on-dark@${s}x.png`),
    { scale: s, background: BG, pad: 40 * s },
  );
}
for (const px of [256, 512, 1024])
  await renderSvg(svgs.mark, path.join(out.png, `mark-${px}.png`), {
    scale: px / 112,
  });

// Padded mark, for placements that crop the image (round avatars, social profiles): a full-bleed
// square of the mark's background, with the tiles scaled down to the middle so a crop can't reach
// them (even a circle: the tiles' corners stay well inside it).
const PADDED_SCALE = 0.78;
const MARK_BG = '<rect width="112" height="112" rx="24" fill="#1B1A1F"/>';
if (!svgs.mark.includes(MARK_BG))
  throw new Error("mark.svg: the background rect changed; update MARK_BG");
const paddedMark = svgs.mark
  .replace(
    MARK_BG,
    `<rect width="112" height="112" fill="${DEEP}"/>` +
      `<g transform="translate(56 56) scale(${PADDED_SCALE}) translate(-56 -56)">`,
  )
  .replace(/<\/svg>\s*$/, "</g></svg>");
await writeFile(path.join(out.svg, "mark-padded.svg"), paddedMark);
for (const px of [256, 512, 1024])
  await renderSvg(paddedMark, path.join(out.png, `mark-padded-${px}.png`), {
    scale: px / 112,
  });

// Transparent mark: the tiles where the mark has them, without the background square.
const transparentMark = svgs.mark.replace(MARK_BG, "");
await writeFile(path.join(out.svg, "mark-transparent.svg"), transparentMark);
for (const px of [256, 512, 1024])
  await renderSvg(
    transparentMark,
    path.join(out.png, `mark-transparent-${px}.png`),
    { scale: px / 112 },
  );

// Square mark: the tiles where the mark has them, on a full-bleed square of the mark's background.
const squareMark = svgs.mark.replace(
  MARK_BG,
  `<rect width="112" height="112" fill="${DEEP}"/>`,
);
await writeFile(path.join(out.svg, "mark-square.svg"), squareMark);
for (const px of [256, 512, 1024])
  await renderSvg(squareMark, path.join(out.png, `mark-square-${px}.png`), {
    scale: px / 112,
  });

// App icons: full-bleed square (platforms apply their own corner mask).
const icon = (px, file) =>
  renderSvg(svgs.mark, file, { scale: px / 112, background: DEEP });
await icon(180, path.join(out.public, "apple-touch-icon.png"));
await icon(192, path.join(out.public, "icon-192.png"));
await icon(512, path.join(out.public, "icon-512.png"));

// favicon.ico: 16 and 32 px PNGs packed into one ICO.
const favPngs = [];
for (const px of [16, 32])
  favPngs.push(
    await renderSvg(svgs.favicon, path.join(out.png, `favicon-${px}.png`), {
      scale: px / 32,
    }),
  );
await writeFile(
  path.join(out.public, "favicon.ico"),
  packIco(favPngs, [16, 32]),
);

// Share image (Open Graph / X), 1200×630.
// Same slot board as the site background: 44px hatched slots on a 48px pitch.
const boardSvg = ({ w, h, scale = 1, x, y }) =>
  `<svg class="board" width="${w}" height="${h}" viewBox="0 0 ${w / scale} ${h / scale}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="8" fill="#1C1B21"/></pattern>
    <pattern id="slots" x="${x}" y="${y}" width="48" height="48" patternUnits="userSpaceOnUse">
      <rect x="2" y="2" width="44" height="44" rx="8" fill="url(#hatch)" stroke="#3A3842" stroke-opacity=".45"/>
    </pattern>
  </defs>
  <rect width="${w / scale}" height="${h / scale}" fill="url(#slots)"/>
</svg>`;
const fontFace = async (family, weight, file) =>
  `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff;base64,${(await readFile(file)).toString("base64")}) format("woff")}`;
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.setContent(`<html><head><style>
  ${await fontFace("Figtree", 400, fontFile("figtree", "figtree-latin-400-normal.woff"))}
  body{margin:0;width:1200px;height:630px;overflow:hidden;background:${BG};position:relative;font-family:Figtree,sans-serif}
  .board,.fade{position:absolute;inset:0}
  .fade{background:radial-gradient(ellipse 75% 85% at 55% 45%, transparent 0%, ${BG} 78%)}
  .wm{position:absolute;left:72px;top:118px;width:${492 * 2}px}
  p{position:absolute;left:88px;top:430px;margin:0;font-size:38px;line-height:1.35;color:#B7B5BD}
</style></head><body>${boardSvg({ w: 1200, h: 630, x: -10, y: -17 })}<div class="fade"></div><img class="wm" src="${dataUri(svgs.wordmark)}"><p>${TAGLINE.join("<br>")}</p></body></html>`);
await page.evaluate(async () => {
  await document.fonts.ready;
  await document.images[0].decode();
});
await page.screenshot({ path: path.join(out.social, "og.png"), type: "png" });
await page.screenshot({ path: path.join(out.public, "og.png"), type: "png" });

// YouTube channel banner, 2560×1440. YouTube crops it per device: only the centred 1546×423 strip
// shows everywhere, so the wordmark sits inside it and the rest is board.
const BANNER = { w: 2560, h: 1440, safe: { w: 1546, h: 423 }, scale: 2.5 };
const bannerWm = { w: 492 * BANNER.scale, h: 132 * BANNER.scale };
if (bannerWm.w > BANNER.safe.w || bannerWm.h > BANNER.safe.h)
  throw new Error("banner: the wordmark doesn't fit the safe area");
await page.setViewport({
  width: BANNER.w,
  height: BANNER.h,
  deviceScaleFactor: 1,
});
// The board is scaled with the wordmark (2× in the share image) and offset to sit under it the same way.
await page.setContent(`<html><head><style>
  body{margin:0;width:${BANNER.w}px;height:${BANNER.h}px;overflow:hidden;background:${BG};position:relative}
  .board,.fade{position:absolute;inset:0}
  .fade{background:radial-gradient(ellipse 50% 50% at 50% 50%, transparent 0%, ${BG} 78%)}
  .wm{position:absolute;left:${(BANNER.w - bannerWm.w) / 2}px;top:${(BANNER.h - bannerWm.h) / 2}px;width:${bannerWm.w}px}
</style></head><body>${boardSvg({ w: BANNER.w, h: BANNER.h, scale: BANNER.scale / 2, x: 18, y: 21 })}<div class="fade"></div><img class="wm" src="${dataUri(svgs.wordmark)}"></body></html>`);
await page.evaluate(() => document.images[0].decode());
await page.screenshot({
  path: path.join(out.social, "youtube-banner.png"),
  type: "png",
});

await browser.close();
console.log("brand: wrote brand/logo, brand/social and public icons");

/** Minimal ICO container holding PNG images (supported by all current browsers and Windows Vista+). */
function packIco(pngs, sizes) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(sizes[i] % 256, e);
    header.writeUInt8(sizes[i] % 256, e + 1);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}
