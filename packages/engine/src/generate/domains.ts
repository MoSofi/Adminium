/**
 * FK-cluster domain detection — 05-introspection-engine.md §8.3.
 *
 * Domains drive "one `page-dashboard` per domain" (research/widget-registry.md
 * §15): connected components over the relation graph (declared + accepted
 * inferred, confidence ≥ 0.8); singleton tables attach to the component they
 * share a name prefix with, else to a "General" domain. Domain naming: schema
 * name when meaningful, else the most-central (weighted hub) table's plural
 * label.
 */

import type { DatabaseModel, TableModel } from '../schema-model.js';
import { humanize, pluralizeWord, slugify } from './util.js';

export interface Domain {
  /** Deterministic kebab-case key, e.g. `orders`. */
  key: string;
  /** Human label, e.g. `Orders`. */
  label: string;
  /** All member table ids, sorted. */
  tableIds: string[];
  /** The weighted hub — highest relation degree, ties by row estimate then name. */
  hubTableId: string;
}

/** Relations that count as domain edges (§6 thresholds: accepted at ≥ 0.8). */
const EDGE_CONFIDENCE = 0.8;

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(x: string): string {
    let root = this.parent.get(x) ?? x;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    // Deterministic root selection: smaller id wins.
    if (ra === rb) return;
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

function sharedPrefix(a: string, b: string): boolean {
  const ta = (a.split('.').pop() ?? a).split('_')[0] ?? '';
  const tb = (b.split('.').pop() ?? b).split('_')[0] ?? '';
  return ta.length >= 3 && ta === tb;
}

/**
 * Detect FK-cluster domains over the model's non-system tables. Join tables
 * participate as edges (their relations connect the sides) but are never
 * chosen as hubs. Components larger than 12 tables would split by schema per
 * §8.3 — with a single schema they stay one domain.
 */
export function detectDomains(model: DatabaseModel, tables: readonly TableModel[]): Domain[] {
  const ids = new Set(tables.map((t) => t.id));
  const uf = new UnionFind();
  const degree = new Map<string, number>();
  for (const id of ids) degree.set(id, 0);

  for (const relation of model.relations) {
    if (relation.confidence < EDGE_CONFIDENCE) continue;
    const { tableId: fromId } = relation.from;
    const { tableId: toId } = relation.to;
    if (!ids.has(fromId) || !ids.has(toId)) continue;
    uf.union(fromId, toId);
    if (fromId !== toId) {
      degree.set(fromId, (degree.get(fromId) ?? 0) + 1);
      degree.set(toId, (degree.get(toId) ?? 0) + 1);
    }
  }

  const components = new Map<string, string[]>();
  const singletons: string[] = [];
  for (const table of [...tables].sort((a, b) => a.id.localeCompare(b.id))) {
    const root = uf.find(table.id);
    const members = components.get(root) ?? [];
    members.push(table.id);
    components.set(root, members);
  }
  for (const [root, members] of [...components]) {
    if (members.length === 1) {
      singletons.push(members[0] as string);
      components.delete(root);
    }
  }

  // Singletons attach to a component sharing a name prefix, else "General".
  const general: string[] = [];
  for (const singleton of singletons) {
    let attached = false;
    for (const members of components.values()) {
      if (members.some((member) => sharedPrefix(member, singleton))) {
        members.push(singleton);
        members.sort();
        attached = true;
        break;
      }
    }
    if (!attached) general.push(singleton);
  }

  const byId = new Map(tables.map((t) => [t.id, t]));
  const hubOf = (members: readonly string[]): string => {
    const candidates = members.filter((id) => byId.get(id)?.semantics?.role !== 'join-table');
    const pool = candidates.length > 0 ? candidates : [...members];
    return [...pool].sort((a, b) => {
      const dd = (degree.get(b) ?? 0) - (degree.get(a) ?? 0);
      if (dd !== 0) return dd;
      const rr = (byId.get(b)?.rowCountEstimate ?? 0) - (byId.get(a)?.rowCountEstimate ?? 0);
      if (rr !== 0) return rr;
      return a.localeCompare(b);
    })[0] as string;
  };

  const named = (members: string[]): Domain => {
    const hub = hubOf(members);
    const hubTable = byId.get(hub);
    // Schema name when meaningful (§8.3), else the hub table's plural label.
    const schema = hubTable?.schema ?? 'public';
    const meaningful = schema !== 'public' && schema !== 'main' && schema !== model.name;
    const rawLabel = meaningful ? humanize(schema) : humanize(hub);
    const heuristic = meaningful
      ? rawLabel
      : rawLabel
          .split(' ')
          .map((w, i, all) => (i === all.length - 1 ? pluralizeWord(w) : w))
          .join(' ');
    // A hub table carrying an effective label (Studio remap / accepted LLM
    // rename) names the domain verbatim — it is already human-authored, so it
    // is never pluralized. The KEY stays heuristic-derived: it feeds dashboard
    // slugs and page ids, which must not move when a table is renamed.
    // DELIBERATE asymmetry: in a meaningful (named) schema the SCHEMA names
    // the domain, so renaming the hub table retitles its crud/archetype pages
    // but NOT the '<Domain> Dashboard' — the schema name stays authoritative.
    const label = meaningful ? heuristic : (hubTable?.label ?? heuristic);
    return { key: slugify(heuristic), label, tableIds: members, hubTableId: hub };
  };

  const domains = [...components.values()].map(named);
  if (general.length > 0) {
    domains.push({
      key: 'general',
      label: 'General',
      tableIds: [...general].sort(),
      hubTableId: hubOf(general),
    });
  }

  // Largest first; ties break on key for determinism.
  domains.sort((a, b) => b.tableIds.length - a.tableIds.length || a.key.localeCompare(b.key));
  return domains;
}
