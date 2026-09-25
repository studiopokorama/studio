import { getCollection, type CollectionEntry } from "astro:content";

export type Project = CollectionEntry<"projects">;

/** How many of the latest projects get a tile on the home board (fewer when they don't fit). */
export const BOARD_PROJECTS = 3;

/** Newest year first, then by `order`. */
export async function getProjects(): Promise<Project[]> {
  const all = await getCollection("projects");
  return all.sort(
    (a, b) => b.data.year - a.data.year || a.data.order - b.data.order,
  );
}

export const projectPath = (id: string) => `/work/${id}/`;
