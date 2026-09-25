import { getCollection, type CollectionEntry } from "astro:content";
import {
  compareProjects,
  findSlugClash,
  folderOf,
  parseFolder,
} from "./project-folder";

export type Project = CollectionEntry<"projects">;

/** How many of the latest projects get a tile on the home board (fewer when they don't fit). */
export const BOARD_PROJECTS = 3;

/** In folder order: the highest number first (see project-folder.ts). */
export async function getProjects(): Promise<Project[]> {
  // Checked on the folders themselves: the collection keeps only one of two clashing entries.
  // (A lazy glob only lists the paths; nothing is loaded.)
  const folders = Object.keys(
    import.meta.glob("./content/projects/*/index.md"),
  ).map(folderOf);
  const clash = findSlugClash(folders);
  if (clash)
    throw new Error(
      `project folders "${clash[0]}" and "${clash[1]}" have the same URL slug`,
    );
  const all = await getCollection("projects");
  return all
    .map((p) => {
      if (!p.filePath) throw new Error(`project ${p.id} has no file path`);
      return {
        p,
        order: parseFolder(folderOf(p.filePath)).order,
        year: p.data.year,
      };
    })
    .sort(compareProjects)
    .map((k) => k.p);
}

export const projectPath = (id: string) => `/work/${id}/`;
