/**
 * `page-builder` template stories (M7-T06): the four flavors the annex names
 * for this template's comps — an invoice document canvas with palette +
 * inspector, the report flavor (the kindMeta-fixed palette copy), the survey
 * flavor with LIVE publish counts, and the automation flow. Typed loosely —
 * the 04-T17 QA harness wires widgets stories into the workspace Storybook.
 */
import { useState } from 'react';
import type { AutosaveStatus } from '@adminium/ui';

import { PageBuilder } from './PageBuilder.js';
import { builderDemoData } from './builder-config.js';

const meta = {
  title: 'Templates/PageBuilder',
};
export default meta;

/** Invoice Builder: palette rail + paper canvas + doc inspector, demo doc. */
export const InvoiceFlavor = {
  render: () => (
    <div className="h-[720px]">
      <PageBuilder config={{ docType: 'invoice' }} data={builderDemoData('invoice', 21)} />
    </div>
  ),
};

/** Report Builder: the block-kind registry with the [label, icon] swap fixed. */
export const ReportFlavor = {
  render: () => (
    <div className="h-[720px]">
      <PageBuilder config={{ docType: 'report' }} data={builderDemoData('report', 8)} />
    </div>
  ),
};

/** Survey Builder: question canvas + live summary; Publish shows LIVE counts. */
export const SurveyFlavor = {
  render: () => (
    <div className="h-[720px]">
      <PageBuilder config={{ docType: 'survey' }} data={builderDemoData('survey', 5)} />
    </div>
  ),
};

/** Automation Rules: flow canvas, non-removable trigger, run-stat inspector. */
export const AutomationFlavor = {
  render: () => (
    <div className="h-[720px]">
      <PageBuilder config={{ docType: 'automation' }} data={builderDemoData('automation', 13)} />
    </div>
  ),
};

/** The autosave choreography cycling through the pill states (09 §7.11). */
function AutosaveDemo() {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  return (
    <div className="h-[720px]">
      <button
        type="button"
        onClick={() =>
          setStatus((current) =>
            current === 'idle' ? 'dirty' : current === 'dirty' ? 'saving' : current === 'saving' ? 'saved' : 'idle',
          )
        }
      >
        Advance autosave state ({status})
      </button>
      <PageBuilder
        config={{ docType: 'email' }}
        data={builderDemoData('email', 3)}
        autosave={status}
        savedAt={Date.UTC(2026, 5, 1, 9, 30)}
      />
    </div>
  );
}

export const EmailAutosave = {
  render: () => <AutosaveDemo />,
};
