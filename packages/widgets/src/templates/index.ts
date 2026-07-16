/**
 * Page templates (04-widget-registry.md §10) — the manifest system.
 *
 * Two layers live under `src/templates/`:
 *   - **the manifest engine** (this barrel): `pageTemplateSchema`, the shipped
 *     `page-*.json` manifests, `composeTemplate`, and the registry cross-check.
 *     Pure data + pure functions; the Engine's generator consumes them.
 *   - **template components** (`page-crud/`, `page-dashboard/`): the React
 *     surfaces that render a stored page. They are exported from the package
 *     root, not here, and are unaffected by the manifest system — the manifests
 *     *describe* their composition (see `manifests.ts`).
 */
export {
  InvalidPageTemplateError,
  pageTemplateSchema,
  parsePageTemplate,
  slotAcceptsSchema,
  slotAreaSchema,
  slotCapacity,
  slotFallbackSchema,
  slotRepeatFlowSchema,
  slotRepeatSchema,
  templateChromeSchema,
  templateSlotSchema,
  type PageTemplate,
  type PageTemplateInput,
  type SlotAccepts,
  type SlotArea,
  type SlotFallback,
  type SlotRepeat,
  type SlotRepeatFlow,
  type TemplateChrome,
  type TemplateSlot,
} from './template-schema.js';

export {
  DuplicatePageTemplateManifestError,
  PAGE_TEMPLATE_IDS,
  buildTemplateManifests,
  getPageTemplateManifest,
  pageTemplateManifests,
} from './manifests.js';

export {
  EMPTY_STATE_WIDGET_ID,
  composeTemplate,
  slotAccepts,
  slotInstanceArea,
  templateKind,
  type ComposeContext,
  type ComposeResult,
  type ComposeWarning,
  type ComposeWarningCode,
  type ComposedPage,
  type ComposedPageKind,
  type TemplateCandidate,
} from './compose.js';

export {
  PENDING_TEMPLATE_WIDGET_IDS,
  crossCheckTemplate,
  crossCheckTemplates,
  type CrossCheckCode,
  type CrossCheckIssue,
} from './crosscheck.js';
