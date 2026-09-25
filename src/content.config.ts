import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/**
 * One folder per project: src/content/projects/<slug>/index.md, with its images next to it.
 * The folder name is the slug, used in the project's URL (/work/<slug>/).
 */
const projects = defineCollection({
  loader: glob({
    pattern: "*/index.md",
    base: "./src/content/projects",
    generateId: ({ entry }) => entry.split("/")[0]!,
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** One or two sentences: shown on the project view and used as its link-preview text. */
      description: z.string(),
      year: z.number().int(),
      tags: z.array(z.string()).default([]),
      /** Tie-breaker within a year: lower comes first. Newer years always come first. */
      order: z.number().default(0),
      /** The first image is the cover: the tile on the home page and the preview image. */
      images: z.array(z.object({ src: image(), alt: z.string() })).min(1),
      /** YouTube video IDs (the 11 characters after watch?v=). */
      youtube: z.array(z.string().regex(/^[\w-]{11}$/)).default([]),
      /** Buttons on the project view. The first is the primary one. */
      links: z
        .array(z.object({ label: z.string(), href: z.url() }))
        .default([]),
    }),
});

export const collections = { projects };
