// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `@adminium/ui` shim a page bundle's build aliases that specifier to
 * (see `./index.ts`), so the page uses the HOST's copy of
 * the UI kit.
 *
 * A second copy of the kit would render unstyled — the dashboard's CSS is generated from the sources it scans, and an add-on's bundled copy is not among them.
 *
 * The names are `ADD_ON_UI_EXPORTS` and nothing else: an ES module cannot export a
 * name it does not spell, which is what makes this list the API rather than a
 * description of one. `add-on-host.test.ts` holds the two equal.
 */

import { requireAddOnHost } from './index.js';

const ui = requireAddOnHost().ui;

export const Alert = ui['Alert'] as never;
export const AutosaveIndicator = ui['AutosaveIndicator'] as never;
export const Badge = ui['Badge'] as never;
export const Button = ui['Button'] as never;
export const EmptyState = ui['EmptyState'] as never;
export const IconButton = ui['IconButton'] as never;
export const Modal = ui['Modal'] as never;
export const ModalBody = ui['ModalBody'] as never;
export const ModalFooter = ui['ModalFooter'] as never;
export const ModalHeader = ui['ModalHeader'] as never;
export const Popover = ui['Popover'] as never;
export const PopoverContent = ui['PopoverContent'] as never;
export const PopoverTrigger = ui['PopoverTrigger'] as never;
export const SearchInput = ui['SearchInput'] as never;
export const SegmentedControl = ui['SegmentedControl'] as never;
export const Spinner = ui['Spinner'] as never;
export const Tabs = ui['Tabs'] as never;
export const TabsContent = ui['TabsContent'] as never;
export const TabsList = ui['TabsList'] as never;
export const TabsTrigger = ui['TabsTrigger'] as never;
export const Tag = ui['Tag'] as never;
export const cn = ui['cn'] as never;

export default ui;
