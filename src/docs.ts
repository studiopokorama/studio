import { getCollection, type CollectionEntry } from "astro:content";
import { compareProjects, parseFolder } from "./project-folder";

export type DocPage = CollectionEntry<"pages">;

/** Text pages in footer order: the highest file number first ("3-privacy.md" before "1-about.md"). */
export async function getDocPages(): Promise<DocPage[]> {
  const all = await getCollection("pages");
  return all
    .map((p) => {
      if (!p.filePath) throw new Error(`page ${p.id} has no file path`);
      const name = p.filePath.split(/[\\/]/).at(-1)!.replace(/\.md$/, "");
      return { p, order: parseFolder(name).order, year: 0 };
    })
    .sort(compareProjects)
    .map((k) => k.p);
}

export const docPath = (id: string) => `/${id}/`;
