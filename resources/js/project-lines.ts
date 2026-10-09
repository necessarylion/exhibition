import type { ProjectLine } from "./api";

/** The lines of one supplier that are not in an order yet. One group becomes one order. */
export interface SupplierGroup {
  companyId: string;
  companyName: string;
  lines: ProjectLine[];
  totalCents: number;
}

export function groupNotSent(lines: ProjectLine[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const line of lines) {
    if (line.state !== "not_sent") {
      continue;
    }
    let group = groups.get(line.companyId);
    if (!group) {
      group = {
        companyId: line.companyId,
        companyName: line.companyName,
        lines: [],
        totalCents: 0,
      };
      groups.set(line.companyId, group);
    }
    group.lines.push(line);
    group.totalCents += line.lineTotalCents;
  }
  return [...groups.values()];
}

export function sumGroups(groups: SupplierGroup[]): { count: number; totalCents: number } {
  let count = 0;
  let totalCents = 0;
  for (const group of groups) {
    count += group.lines.length;
    totalCents += group.totalCents;
  }
  return { count, totalCents };
}
