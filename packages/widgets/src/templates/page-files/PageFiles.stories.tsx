// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-files` template stories (09 §7.9): the demo-mode composition
 * (file-browser + usage-meter), a bound run over an attachments-shaped table
 * (generated-vocabulary config keys + real column names), the loading/error
 * states through the `states` override, and an upload-enabled run with live
 * progress jobs — four states, matching the template-story idiom.
 */
import { PageFiles } from './PageFiles.js';
import { demoFilesLayout } from './demo-layout.js';

const meta = {
  title: 'Templates/PageFiles',
};
export default meta;

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

/** Attachments-shaped rows — real column names, self-FK folder hierarchy. */
const ATTACHMENT_ROWS = [
  { id: 'f-1', file_name: 'Contracts', file_type: 'folder', parent_id: null, updated_at: new Date(NOW - 86_400_000).toISOString() },
  { id: 'f-2', file_name: 'Coastal House.pdf', file_type: 'pdf', parent_id: 'f-1', file_size: 2_400_000, updated_at: new Date(NOW - 3_600_000).toISOString(), is_starred: true },
  { id: 'f-3', file_name: 'Site Photos.zip', file_type: 'archive', parent_id: null, file_size: 42_000_000, updated_at: new Date(NOW - 7_200_000).toISOString(), is_starred: false },
  { id: 'f-4', file_name: 'Budget.xlsx', file_type: 'sheet', parent_id: null, file_size: 812_000, updated_at: new Date(NOW - 600_000).toISOString(), is_starred: false },
];

/** Demo mode (04 §5.3): no adapter — every widget seeds from its instance id. */
export const DemoMode = {
  render: () => <PageFiles layout={demoFilesLayout} />,
};

/** Bound attachments table: generated config keys + detected column names. */
export const BoundAttachments = {
  render: () => (
    <PageFiles
      layout={{
        ...demoFilesLayout,
        items: demoFilesLayout.items.map((item) =>
          item.i === 'browser'
            ? { ...item, config: { title: 'Attachments', nameColumn: 'file_name', parentColumn: 'parent_id' } }
            : item,
        ),
      }}
      states={{
        browser: { status: 'success', data: { rows: ATTACHMENT_ROWS, total: ATTACHMENT_ROWS.length } },
        usage: { status: 'success', data: { value: 45_212_000 } },
      }}
    />
  ),
};

/** Loading + failed query — the slot-level states, page never crashes. */
export const LoadingAndError = {
  render: () => (
    <div className="flex flex-col gap-8">
      <PageFiles layout={demoFilesLayout} states={{ browser: { status: 'loading' } }} />
      <PageFiles
        layout={demoFilesLayout}
        states={{ browser: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} } }}
      />
    </div>
  ),
};

/** Upload transport wired (future files routes): dropzone live + progress. */
export const UploadEnabled = {
  render: () => (
    <PageFiles
      layout={demoFilesLayout}
      states={{
        browser: { status: 'success', data: { rows: ATTACHMENT_ROWS } },
        usage: { status: 'success', data: { value: 45_212_000 } },
      }}
      onUpload={() => {}}
      uploadJobs={[
        { id: 'job-1', name: 'Walkthrough.mp4', status: 'uploading', pct: 62 },
        { id: 'job-2', name: 'Contract - signed.pdf', status: 'done', pct: 100, url: '/uploads/job-2' },
        { id: 'job-3', name: 'Logo Variants.zip', status: 'failed', pct: 34, error: 'Network error — the connection dropped mid-upload.' },
      ]}
      onRetryUpload={() => {}}
    />
  ),
};
