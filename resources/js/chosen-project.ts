const KEY = "catalog_project_id";

// The browser can block localStorage (private window). Then the choice lasts for one page only.

/** The project that the catalog adds items to. */
export function getChosenProjectId(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setChosenProjectId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Nothing to do. The page keeps the choice in memory.
  }
}
