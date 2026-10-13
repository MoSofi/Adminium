// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the import wizard is drawn with: the wizard shell, the dropzone, the
 * table that maps a file's columns and the list of what the type check found.
 * Each is the component alone: none reaches the widget registry, a config
 * schema (zod) or the translator (i18next). The wizard is the dashboard's
 * Import page and a part on an app's own screen, and on the second none of
 * those may be fetched; apps/dashboard/scripts/check-kit-build.mjs holds it to that.
 */
export { PageWizard } from './templates/page-wizard/PageWizard.js';
export { UploadDropzone, type UploadDropzoneProps } from './families/media/UploadDropzone.js';
export { MappingTable, mappingRowsFor, type MappingRow, type MappingTableProps, type MappingTarget } from './families/forms/MappingTable.js';
export { IssuesList, type IssuesListProps, type ValidationIssue } from './families/forms/IssuesList.js';
export { DEFAULT_MAPPING_TARGETS, SKIP_TARGET } from './families/forms/forms-builders.js';
