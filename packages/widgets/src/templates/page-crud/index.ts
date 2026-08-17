// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-crud` template (09-generated-app.md §7.1; 04 §10) — the component the
 * dashboard PageRenderer mounts for `template: 'page-crud'` envelopes, plus
 * the CrudApi adapter contract the interpreter implements against the
 * generated CRUD API.
 */
export {
  CRUD_FILTER_OPS,
  isDeletePreview,
  type CrudApi,
  type CrudBulkResult,
  type CrudDeletePreview,
  type CrudExportFormat,
  type CrudExportRequest,
  type CrudExportTicket,
  type CrudFilter,
  type CrudFilterCondition,
  type CrudFilterOp,
  type CrudGetResult,
  type CrudListParams,
  type CrudListResult,
  type CrudLookupOption,
  type CrudMutationResult,
  type CrudReferenceCount,
  type CrudRow,
  type CrudSort,
} from './crud-api.js';
export {
  SEGMENTED_MAX_ARITY,
  coerceFieldValue,
  fieldKindFor,
  fieldTypeTag,
  formColumns,
  isRequired,
  type FieldKind,
} from './field-mapping.js';
export { FK_LOOKUP_DEBOUNCE_MS, RecordForm, type RecordFormProps } from './RecordForm.js';
export { RecordDetail, type RecordDetailProps } from './RecordDetail.js';
export {
  PAGE_CRUD_TEMPLATE_ID,
  PageCrud,
  SEARCH_DEBOUNCE_MS,
  type PageCrudGridState,
  type PageCrudLabels,
  type PageCrudProps,
} from './PageCrud.js';
