// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-directory` template stories (M7 people track): the Team Directory
 * card grid with search + dept chips, the Org Chart tree variant on a
 * self-FK people table, the filtered/error/loading states, and the invalid
 * stored-config notice. Deterministic data — no adapter, canned states only.
 */
import { PageDirectory } from './PageDirectory.js';

const meta = {
  title: 'Templates/PageDirectory',
};
export default meta;

const binding = {
  kind: 'table-query',
  connectionId: 'story-conn',
  source: { name: 'employees', schema: 'public', type: 'table' },
  shape: 'record-list',
  limit: 60,
};

const PEOPLE = [
  { id: 'p1', name: 'Ava Reyes', role: 'Chief Executive', dept: 'Executive', email: 'ava@acme.dev', manager_id: null },
  { id: 'p2', name: 'Morgan Lee', role: 'VP Engineering', dept: 'Engineering', email: 'morgan@acme.dev', manager_id: 'p1' },
  { id: 'p3', name: 'Riley Cho', role: 'VP Design', dept: 'Design', email: 'riley@acme.dev', manager_id: 'p1' },
  { id: 'p4', name: 'Kai Ndlovu', role: 'Frontend Lead', dept: 'Engineering', email: 'kai@acme.dev', manager_id: 'p2' },
  { id: 'p5', name: 'Priya Rao', role: 'Backend Lead', dept: 'Engineering', email: 'priya@acme.dev', manager_id: 'p2' },
  { id: 'p6', name: 'Taylor Kim', role: 'Product Design', dept: 'Design', email: 'taylor@acme.dev', manager_id: 'p3' },
  { id: 'p7', name: 'Sam Park', role: 'Delivery Lead', dept: 'Operations', email: 'sam@acme.dev', manager_id: 'p1' },
];

const galleryConfig = {
  templateVersion: 1,
  toolbar: ['filter-chip-bar', 'global-search'],
  overlays: ['toast-stack'],
  archetype: { score: 0.9, reasons: ['people-shaped table (annex §14)'] },
  layout: {
    version: 1,
    items: [
      {
        i: 'directory',
        widget: 'card-gallery',
        x: 0,
        y: 2,
        w: 12,
        h: 14,
        config: { title: 'Employees', titleColumn: 'name', binding },
      },
    ],
  },
};

const orgConfig = {
  ...galleryConfig,
  layout: {
    version: 1,
    items: [
      {
        i: 'directory',
        widget: 'org-chart',
        x: 0,
        y: 2,
        w: 12,
        h: 14,
        config: { title: 'Employees', parentColumn: 'manager_id', labelColumn: 'name', binding },
      },
    ],
  },
};

/** Team Directory comp: card grid + search + dept chips + record drawer. */
export const TeamDirectory = {
  render: () => (
    <div className="h-[560px]">
      <PageDirectory
        config={galleryConfig}
        states={{ directory: { status: 'success', data: { data: PEOPLE } } }}
      />
    </div>
  ),
};

/** Org Chart comp: the tree variant on a self-referential manager FK. */
export const OrgChartVariant = {
  render: () => (
    <div className="h-[560px]">
      <PageDirectory
        config={orgConfig}
        states={{ directory: { status: 'success', data: PEOPLE } }}
      />
    </div>
  ),
};

/** First-use empty vs a failed directory query (Retry via refetch). */
export const EmptyAndError = {
  render: () => (
    <div className="flex h-[420px] flex-col gap-4">
      <PageDirectory config={galleryConfig} states={{ directory: { status: 'success', data: [] } }} />
      <PageDirectory
        config={galleryConfig}
        states={{
          directory: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} },
        }}
      />
    </div>
  ),
};

/** Loading skeleton + the non-crashing invalid stored-config notice. */
export const LoadingAndInvalid = {
  render: () => (
    <div className="flex h-[420px] flex-col gap-4">
      <PageDirectory config={galleryConfig} states={{ directory: { status: 'loading' } }} />
      <PageDirectory config={{ layout: { version: 99, items: 'nope' } }} />
    </div>
  ),
};
