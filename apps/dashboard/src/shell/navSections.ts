/**
 * Per-connection nav sectioning (M5-T05 follow-up to Wave 1): with two or
 * more connected databases the generated nav groups are ambiguous ("Orders"
 * from which source?), so the sidebar sub-labels each group's items by the
 * owning connection's display name. With zero or one connection the sidebar
 * stays flat — no redundant label. Pure helpers, i18n-free (the component
 * localizes the shared-items label).
 */
import type { NavItem, NavTree } from '../app/bootstrap.js';

export interface NavSection {
  /** Owning connection id; null for shared (user/system) pages. */
  connectionId: string | null;
  /** Display name from the server; null for shared pages or old payloads. */
  connectionName: string | null;
  items: NavItem[];
}

/** Distinct connections across the whole tree — the multi-source signal. */
export function distinctConnectionCount(nav: NavTree): number {
  const ids = new Set<string>();
  for (const group of nav.groups) {
    for (const item of group.items) {
      if (item.connectionId != null) ids.add(item.connectionId);
    }
  }
  return ids.size;
}

/**
 * Clusters one group's items by connection in first-appearance order,
 * preserving the server's item order inside each cluster.
 */
export function sectionNavItems(items: readonly NavItem[]): NavSection[] {
  const sections: NavSection[] = [];
  const byConnection = new Map<string | null, NavSection>();
  for (const item of items) {
    const key = item.connectionId ?? null;
    let section = byConnection.get(key);
    if (section === undefined) {
      section = { connectionId: key, connectionName: item.connectionName ?? null, items: [] };
      byConnection.set(key, section);
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}
