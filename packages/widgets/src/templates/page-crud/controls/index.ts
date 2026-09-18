// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The control registry: one entry per control in Appendix C, and NOTHING that
 * decides which one a column gets — that is `controlFor`'s answer, and it lives
 * in the page-config leaf where the designer, the server and the renderer can
 * all read the same rule.
 *
 * ─── Why a map and not a switch ────────────────────────────────────────────
 *
 * A switch grows a branch per (control × caller) pair and is impossible to
 * check for completeness. `Record<FormControl, ControlEntry>` is checked by the
 * type system: a control added to the catalog and not to this map does not
 * compile, which is the whole reason the catalog is a closed union.
 */
import type { FormControl } from '../../../page-config/index.js';
import { CheckRowControl, CheckRowsControl, ToggleRowControl } from './boolean.js';
import { CalendarControl } from './calendar.js';
import { ChipsControl } from './chips.js';
import {
  ChoiceCardsControl,
  PillSwitchControl,
  SegmentedChoiceControl,
  SelectControl,
} from './choice.js';
import { AttachmentsControl, AvatarControl, ImageControl } from './file.js';
import {
  CurrencyControl,
  DateControl,
  DateTimeControl,
  NumberControl,
  SliderControl,
  StepperControl,
  TimeControl,
} from './number.js';
import { ReferenceChipsControl } from './reference-chips.js';
import { ReadonlyControl, ReferenceControl } from './reference.js';
import {
  EmailControl,
  JsonControl,
  MonoControl,
  PasswordControl,
  PhoneControl,
  TextControl,
  TextareaControl,
  TitleControl,
  UrlControl,
} from './text.js';
import type { ControlEntry } from './types.js';

export type { ControlEntry, ControlOption, ControlProps } from './types.js';

export const CONTROL_COMPONENTS: Readonly<Record<FormControl, ControlEntry>> = {
  text: { component: TextControl },
  title: { component: TitleControl },
  textarea: { component: TextareaControl },
  mono: { component: MonoControl },
  email: { component: EmailControl },
  url: { component: UrlControl },
  phone: { component: PhoneControl },
  password: { component: PasswordControl },
  number: { component: NumberControl },
  currency: { component: CurrencyControl },
  stepper: { component: StepperControl },
  slider: { component: SliderControl },
  date: { component: DateControl },
  time: { component: TimeControl },
  datetime: { component: DateTimeControl },
  select: { component: SelectControl },
  segmented: { component: SegmentedChoiceControl },
  'pill-switch': { component: PillSwitchControl },
  'choice-cards': { component: ChoiceCardsControl },
  // These two draw their own label inside a bordered row (comp 258–261,
  // 402–407), so the renderer must not wrap them in a `FormField`.
  'toggle-row': { component: ToggleRowControl, ownsLabel: true },
  'check-row': { component: CheckRowControl, ownsLabel: true },
  chips: { component: ChipsControl },
  reference: { component: ReferenceControl },
  // A relation's own control: chips for what is linked, a picker to add more.
  // A COLUMN is never given it (`legalControls` offers it to no column at all);
  // a relation FIELD is rendered with a stand-in column carrying the target.
  'reference-chips': { component: ReferenceChipsControl },
  image: { component: ImageControl },
  avatar: { component: AvatarControl },
  attachments: { component: AttachmentsControl },
  json: { component: JsonControl },
  calendar: { component: CalendarControl, ownsLabel: true },
  readonly: { component: ReadonlyControl },
};

/** The any-of shape, which a list-valued column reaches through `check-row`. */
export { CheckRowsControl };
