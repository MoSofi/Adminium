/**
 * Bundled en-US resources (10-i18n-theming.md §2.3): the fallback language
 * ships in the main bundle and must never be async. All five namespaces are
 * bundled this wave (the studio/generated lazy split lands with the M8
 * extraction pipeline, 10-T06/10-T10). TS mirrors of the canonical JSON —
 * see ./en-us/*.ts headers and parity.test.ts.
 */
import common from './en-us/common.js';
import errors from './en-us/errors.js';
import generated from './en-us/generated.js';
import studio from './en-us/studio.js';
import ui from './en-us/ui.js';

export const NAMESPACES = ['common', 'ui', 'studio', 'generated', 'errors'] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** A single namespace's message tree (nested string leaves). */
export type ResourceBundle = { readonly [key: string]: string | ResourceBundle };

export const EN_US_RESOURCES: Record<Namespace, ResourceBundle> = {
  common,
  ui,
  studio,
  generated,
  errors,
};
