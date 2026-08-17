// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Builder surfaces (M7-T06): the `page-builder` template binding (invoice /
 * report / survey / automation flavors over adminium_pages) and the Email
 * Templates manager+editor (adminium_email_templates via the email-templates
 * API contract).
 */
export { PageBuilderBinding, BUILDER_AUTOSAVE_DEBOUNCE_MS } from './PageBuilderBinding.js';
export { EmailTemplatesPage, EMAIL_AUTOSAVE_DEBOUNCE_MS } from './EmailTemplatesPage.js';
export {
  builderPageStateOf,
  builderVersionConfigOf,
  builderVersionsOf,
  layoutWithDoc,
  type BuilderPageState,
  type BuilderVersion,
  type BuilderVersionConfig,
} from './docState.js';
export { docToEmailBlocks, emailBlocksToDoc, type EmailDocState } from './emailDoc.js';
