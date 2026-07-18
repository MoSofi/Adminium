/**
 * `page-wizard` template (04 §10 archetype 12; 09-generated-app.md §11.1) —
 * the stepped-flow shell the dashboard PageRenderer mounts for
 * `template: 'page-wizard'` envelopes (the Import Wizard is its first
 * occupant). The manifest lives in `./page-wizard.json` until assembly wires
 * it into `../manifests.ts` (see the note in page-wizard.test.tsx).
 */
export {
  PAGE_WIZARD_TEMPLATE_ID,
  PageWizard,
  wizardStepState,
  type PageWizardProps,
  type WizardStepDef,
  type WizardStepState,
} from './PageWizard.js';
