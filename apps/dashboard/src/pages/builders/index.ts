// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Builder surfaces (M7-T06): the `page-builder` template binding (invoice /
 * report / survey / automation flavors over adminium_pages). The Email
 * Templates manager and editor moved to `src/email/` (39-email-templates-and-
 * campaigns.md D16).
 */
export { PageBuilderBinding, BUILDER_AUTOSAVE_DEBOUNCE_MS } from './PageBuilderBinding.js';
export {
  builderPageStateOf,
  builderVersionConfigOf,
  builderVersionsOf,
  layoutWithDoc,
  type BuilderPageState,
  type BuilderVersion,
  type BuilderVersionConfig,
} from './docState.js';
