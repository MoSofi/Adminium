/**
 * `page-wizard` template stories (M7-T07): the four §11.1 Import-Wizard
 * states — upload, mapping (mid-flow with a done step), a failed run
 * (error override), and the final review step — composed from the family
 * widgets the manifest names, all on deterministic seeded demo data.
 */
import { PageWizard } from './PageWizard.js';
import {
  columnMappingTableConfigSchema,
  columnMappingTableDemoData,
  validationIssuesListConfigSchema,
  validationIssuesListDemoData,
} from '../../families/forms/forms-config.js';
import { ColumnMappingTableWidget } from '../../families/forms/ColumnMappingTable.js';
import { ValidationIssuesListWidget } from '../../families/forms/ValidationIssuesList.js';

const meta = {
  title: 'Templates/PageWizard',
};
export default meta;

const STEPS = [
  { id: 'upload', label: 'Upload', description: 'Pick a CSV file to import.' },
  { id: 'map', label: 'Map columns', description: 'Match file columns to table fields.' },
  { id: 'validate', label: 'Validate', description: 'Review issues before running.' },
  { id: 'run', label: 'Import & review' },
];

const noop = () => undefined;

/** Step 1 — nothing done yet, host CTA in the body. */
export const UploadStep = {
  render: () => (
    <div style={{ blockSize: 420 }}>
      <PageWizard steps={STEPS} activeStepId="upload" footer={<button type="button">Next</button>}>
        <div className="grid h-full place-items-center rounded-lg border border-dashed border-border text-fg-muted">
          Drop a CSV here
        </div>
      </PageWizard>
    </div>
  ),
};

/** Step 2 — mid-flow: Upload done, mapping table live. */
export const MappingStep = {
  render: () => (
    <div style={{ blockSize: 420 }}>
      <PageWizard
        steps={STEPS}
        activeStepId="map"
        onSelectStep={noop}
        footer={<button type="button">Validate</button>}
      >
        <ColumnMappingTableWidget
          config={columnMappingTableConfigSchema.parse({})}
          data={columnMappingTableDemoData(7)}
          instanceId="story-mapping"
          onEvent={noop}
        />
      </PageWizard>
    </div>
  ),
};

/** Step 3 with an error override on the run step (a previous run failed). */
export const ValidationWithFailedRun = {
  render: () => (
    <div style={{ blockSize: 420 }}>
      <PageWizard
        steps={STEPS}
        activeStepId="validate"
        stepStates={{ run: 'error' }}
        onSelectStep={noop}
        footer={<button type="button">Run import</button>}
      >
        <ValidationIssuesListWidget
          config={validationIssuesListConfigSchema.parse({})}
          data={validationIssuesListDemoData(4)}
          instanceId="story-issues"
          onEvent={noop}
        />
      </PageWizard>
    </div>
  ),
};

/** Step 4 — everything done; review body is host content (KPI numbers). */
export const ReviewStep = {
  render: () => (
    <div style={{ blockSize: 420 }}>
      <PageWizard steps={STEPS} activeStepId="run" stepStates={{ run: 'done' }} onSelectStep={noop}>
        <div className="text-body-sm text-fg">2,940 imported = 2,612 created + 288 updated + 40 skipped</div>
      </PageWizard>
    </div>
  ),
};
