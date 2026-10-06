// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data kit's shim: what a page bundle's build aliases
 * `@adminium/add-on-data` to (see `./index.ts`), so the page lays itself out
 * with the HOST's parts and reads and writes its add-on's tables through the
 * HOST's hooks — the signed-in reader's grants, the dashboard's own cache.
 *
 * The names are `ADD_ON_DATA_EXPORTS` and nothing else; `add-on-host.test.ts`
 * holds the two equal. Importing this module on a host that publishes no kit,
 * or an older one, throws `AddOnHostTooOld` — which the host shows as "This
 * page needs a newer Adminium."
 */

import { requireAddOnData } from './index.js';

const data = requireAddOnData();

export const Card = data['Card'] as never;
export const Grid = data['Grid'] as never;
export const Stack = data['Stack'] as never;
export const Sheet = data['Sheet'] as never;
export const SheetHeader = data['SheetHeader'] as never;
export const SheetBody = data['SheetBody'] as never;
export const SheetFooter = data['SheetFooter'] as never;
export const StickyBar = data['StickyBar'] as never;
export const Divider = data['Divider'] as never;
export const Skeleton = data['Skeleton'] as never;
export const DataTable = data['DataTable'] as never;
export const Stat = data['Stat'] as never;
export const KeyValueList = data['KeyValueList'] as never;
export const StatusPill = data['StatusPill'] as never;
export const ProgressBar = data['ProgressBar'] as never;
export const Pagination = data['Pagination'] as never;
export const MonoText = data['MonoText'] as never;
export const Field = data['Field'] as never;
export const Input = data['Input'] as never;
export const NumberInput = data['NumberInput'] as never;
export const Textarea = data['Textarea'] as never;
export const DateInput = data['DateInput'] as never;
export const Select = data['Select'] as never;
export const Combobox = data['Combobox'] as never;
export const Switch = data['Switch'] as never;
export const Checkbox = data['Checkbox'] as never;
export const RadioGroup = data['RadioGroup'] as never;
export const RadioCard = data['RadioCard'] as never;
export const ToggleChip = data['ToggleChip'] as never;
export const InputGroup = data['InputGroup'] as never;
export const Menu = data['Menu'] as never;
export const MenuItem = data['MenuItem'] as never;
export const ConfirmModal = data['ConfirmModal'] as never;
export const Link = data['Link'] as never;
export const useRecords = data['useRecords'] as never;
export const useRecord = data['useRecord'] as never;
export const useWrite = data['useWrite'] as never;
export const useTreeWrite = data['useTreeWrite'] as never;
export const useStateMove = data['useStateMove'] as never;
export const useAccess = data['useAccess'] as never;
export const useLookUp = data['useLookUp'] as never;
export const useWords = data['useWords'] as never;
export const useDocument = data['useDocument'] as never;
export const useExport = data['useExport'] as never;

export default data;
