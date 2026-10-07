// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data kit the dashboard publishes as `host.data`: the parts an add-on's
 * page is built from and the hooks it reads and writes its tables with. Its
 * keys are `ADD_ON_DATA_EXPORTS` (held equal by `dataKit.test.tsx`), its
 * hooks' signatures the contract package's, checked here by the compiler.
 *
 * A chunk of its own, loaded only for a page whose add-on says it needs the
 * kit (`../runtime.ts`): nothing here reaches the entry, nor a page built
 * before the kit.
 */
import {
  Checkbox,
  Combobox,
  ConfirmModal,
  DateInput,
  Divider,
  InputGroup,
  KeyValueList,
  MonoText,
  Pagination,
  ProgressBar,
  RadioCard,
  RadioGroup,
  SheetBody,
  SheetFooter,
  SheetHeader,
  Skeleton,
  StatusPill,
  Textarea,
} from '@adminium/ui';
import { DATA_KIT_VERSION, type AddOnDataHooks } from '@adminium/add-on-contracts/runtime';

import { Stat } from '../../project/kit/data.js';
import { Link } from '../../project/kit/hooks.js';
import { Input, Select, Switch } from '../../project/kit/inputs.js';
import { Card, Stack } from '../../project/kit/layout.js';
import { Field, NumberInput, ToggleChip } from './fields.js';
import { useAccess, useDocument, useExport, useLookUp, useRead, useRecord, useRecords, useStateMove, useTreeWrite, useWords, useWrite } from './hooks.js';
import { Grid, Sheet, StickyBar } from './layout.js';
import { Menu, MenuItem } from './menu.js';
import { DataTable } from './table.js';

const hooks = { useRecords, useRecord, useRead, useWrite, useTreeWrite, useStateMove, useAccess, useLookUp, useWords, useDocument, useExport } satisfies AddOnDataHooks;

export const dataKit = Object.freeze({
  version: DATA_KIT_VERSION,
  // Layout
  Card,
  Grid,
  Stack,
  Sheet,
  SheetHeader,
  SheetBody,
  SheetFooter,
  StickyBar,
  Divider,
  Skeleton,
  // Read
  DataTable,
  Stat,
  KeyValueList,
  StatusPill,
  ProgressBar,
  Pagination,
  MonoText,
  // Form
  Field,
  Input,
  NumberInput,
  Textarea,
  DateInput,
  Select,
  Combobox,
  Switch,
  Checkbox,
  RadioGroup,
  RadioCard,
  ToggleChip,
  InputGroup,
  Menu,
  MenuItem,
  ConfirmModal,
  // Navigate
  Link,
  ...hooks,
});
