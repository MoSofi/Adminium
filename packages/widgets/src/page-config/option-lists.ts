// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The BUILT-IN option lists.
 *
 * ─── Why these three live in code and not in the store ─────────────────────
 *
 * They are the same in every workspace, and two of them are the runtime's own
 * data rather than ours. Seeding 249 country rows into every install would make
 * a correction to the list a migration, and would make the list's LABELS a
 * translation job the platform already does better: `Intl.DisplayNames` names a
 * region in the viewer's language, which no table of ours can keep up with.
 *
 * What is stored is the CODE — `DE`, `CA`, `female` — so a row means the same
 * thing whatever language the person who wrote it was reading. Editing a
 * built-in makes a copy (an ordinary row), and "store the label" is the same
 * move with the labels as the values.
 *
 * ─── This is a leaf ────────────────────────────────────────────────────────
 *
 * It imports nothing but zod, because `@adminium/engine/config` re-exports it
 * for the server (membership: is `XX` in this list?) and the dashboard imports
 * it directly (rendering: what is `DE` called here?). One list, two readers, no
 * second copy to drift.
 */
import { z } from 'zod';

/** One answer. `label` is absent where the label is computed (a country). */
export const optionListItemSchema = z.object({
  value: z.string().min(1).max(256),
  label: z.string().max(256).optional(),
  tone: z.string().max(40).optional(),
  description: z.string().max(512).optional(),
});
export type OptionListItem = z.infer<typeof optionListItemSchema>;

/** A stored list, as the route serves it and a project file carries it. */
export const optionListSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    // The same slug shape every other key in the product uses, and the reason a
    // list can be named in a file: it is stable, readable and has no id in it.
    .regex(/^[a-z][a-z0-9-]*$/, { message: 'must be a lowercase slug' }),
  name: z.string().min(1).max(200),
  items: z.array(optionListItemSchema).min(1).max(500),
});
export type OptionList = z.infer<typeof optionListSchema>;

export const BUILTIN_PREFIX = 'builtin:';

/** Every built-in key, as a rule names it. */
export const BUILTIN_OPTION_LIST_KEYS = [
  'builtin:countries',
  'builtin:us-states',
  'builtin:gender',
] as const;
export type BuiltinOptionListKey = (typeof BUILTIN_OPTION_LIST_KEYS)[number];

export function isBuiltinOptionList(key: string): key is BuiltinOptionListKey {
  return (BUILTIN_OPTION_LIST_KEYS as readonly string[]).includes(key);
}

/**
 * ISO 3166-1 alpha-2, the 249 officially assigned codes.
 *
 * Codes only: the NAME of a country is `Intl.DisplayNames`'s to give, in the
 * reader's own language, and a table of English names here would be a second
 * answer that ages. Written out rather than derived, because there is no
 * runtime API that enumerates the assigned codes.
 */
export const COUNTRY_CODES: readonly string[] = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

/**
 * The 50 states and DC (O4: the territories are not in this list — they are in
 * `builtin:countries`, which is where an address form that needs Guam looks).
 *
 * The names ARE data here: a state's name is a proper noun, not copy, and no
 * runtime API gives them. English, and the same in every locale.
 */
export const US_STATES: readonly OptionListItem[] = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' }, { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' }, { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' }, { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' }, { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' }, { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' }, { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' }, { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
];

/**
 * The comp's three (752). The VALUES are stable words; their labels are UI copy
 * and translate through `ui:lists.gender.*`, which is why they carry none here.
 */
export const GENDER_VALUES: readonly string[] = ['female', 'male', 'other'];

/**
 * The VALUES a built-in accepts — the only question the server asks.
 *
 * Labels are the reader's business and never travel with the write: the server
 * checks that `DE` is a country, not that somebody's browser calls it Germany.
 */
export function builtinOptionValues(key: string): readonly string[] | null {
  switch (key) {
    case 'builtin:countries':
      return COUNTRY_CODES;
    case 'builtin:us-states':
      return US_STATES.map((item) => item.value);
    case 'builtin:gender':
      return GENDER_VALUES;
    default:
      return null;
  }
}

/**
 * The items a built-in renders as, with labels resolved for `locale`.
 *
 * `Intl.DisplayNames` is asked for a region's name and falls back to the CODE
 * when the runtime has none — "DE" is a worse label than "Germany" and a much
 * better one than an empty option nobody can pick. Gender's labels are UI copy,
 * so the caller passes them in; this leaf has no `t`.
 */
export function builtinOptionItems(
  key: string,
  locale: string,
  genderLabels?: Readonly<Record<string, string>>,
): OptionListItem[] {
  switch (key) {
    case 'builtin:countries': {
      const names = regionNames(locale);
      return COUNTRY_CODES.map((code) => ({ value: code, label: names(code) }));
    }
    case 'builtin:us-states':
      return US_STATES.map((item) => ({ ...item }));
    case 'builtin:gender':
      return GENDER_VALUES.map((value) => ({
        value,
        ...(genderLabels?.[value] === undefined ? {} : { label: genderLabels[value] }),
      }));
    default:
      return [];
  }
}

/** `Intl.DisplayNames`, or the code itself where the runtime has no name. */
function regionNames(locale: string): (code: string) => string {
  try {
    const display = new Intl.DisplayNames([locale], { type: 'region' });
    return (code) => {
      try {
        return display.of(code) ?? code;
      } catch {
        return code;
      }
    };
  } catch {
    return (code) => code;
  }
}
