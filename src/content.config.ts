import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { parseFolder } from "./project-folder";

/**
 * One folder per project: src/content/projects/<order>-<slug>/index.md, with its images next to
 * it. The number sets the listing order (highest first); the slug is the URL (/work/<slug>/).
 */
const projects = defineCollection({
  loader: glob({
    pattern: "*/index.md",
    base: "./src/content/projects",
    generateId: ({ entry }) => parseFolder(entry.split("/")[0]!).slug,
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /**
       * Optional shorter name for tight spots: the home board's small tiles and, on phones, the
       * launcher and the project view's prev/next. Everywhere else uses `title`.
       */
      shortTitle: z.string().optional(),
      /** One or two sentences: shown on the project view and used as its link-preview text. */
      description: z.string(),
      year: z.number().int(),
      tags: z.array(z.string()).default([]),
      /** The first image is the cover: the tile on the home page and the preview image. */
      images: z.array(z.object({ src: image(), alt: z.string() })).min(1),
      /** Portrait images (e.g. phone screenshots): a tall main image, thumbnails in a column beside it. */
      portrait: z.boolean().default(false),
      /** YouTube video IDs (the 11 characters after watch?v=). */
      youtube: z.array(z.string().regex(/^[\w-]{11}$/)).default([]),
      /**
       * Up to two buttons under the description on the project view: the first looks like the
       * home page's main button (lime), the second like "Contact us" (violet outline).
       */
      links: z
        .array(z.object({ label: z.string(), href: z.url() }))
        .max(2)
        .default([]),
    }),
});

/**
 * Simple text pages (privacy policy, terms, about): src/content/pages/<order>-<slug>.md, served
 * at /<slug>/. Linked in the footer, highest number first, labelled `shortTitle` or `title`.
 */
const pages = defineCollection({
  loader: glob({
    pattern: "*.md",
    base: "./src/content/pages",
    generateId: ({ entry }) => parseFolder(entry.replace(/\.md$/, "")).slug,
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** The footer link's label, when `title` is long ("Privacy" for "Privacy policy"). */
      shortTitle: z.string().optional(),
      /** One or two sentences for search results and link previews. */
      description: z.string(),
      /** Shown as "Last updated …" (legal pages). */
      updated: z.coerce.date().optional(),
      /** People shown as a grid under the text (the about page). */
      team: z
        .array(
          z.object({
            name: z.string(),
            role: z.string(),
            /** Square-ish portrait; without one, the tile shows the name's initial. */
            photo: image().optional(),
            links: z
              .array(z.object({ label: z.string(), href: z.url() }))
              .default([]),
          }),
        )
        .default([]),
    }),
});

export const collections = { projects, pages };
