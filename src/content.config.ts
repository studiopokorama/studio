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
      /** Optional shorter name for the home board's tiles, which are small. Everywhere else uses `title`. */
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

export const collections = { projects };
