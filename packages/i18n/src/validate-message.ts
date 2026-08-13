/**
 * Write-time validation for admin-authored messages
 * (23-runtime-translations.md §6.3).
 *
 * This is the ONLY thing standing between an admin's typing and every user's
 * screen, because once a message comes from the meta store the build-time
 * gates cannot see it (23 §10). It runs in the browser (live editor feedback)
 * and on the server (the real boundary) from this one module, so the two can
 * never disagree about what is acceptable.
 *
 * It parses with `IntlMessageFormat(...).getAst()` — the exact mechanism both
 * `IcuFormat` and the parity gate use — rather than a second parser that
 * could accept what the renderer rejects.
 *
 * The rules are deliberately STRICTER than the compiled-bundle parity gate on
 * one axis: argument TYPE must match the source, not just argument name. That
 * is not pedantry, it is the fix for a real hazard — 48 call sites in this
 * repo do their own `.replace('{count}', …)` on the `t()` result and pass no
 * ICU args at all. For those keys, `format()` throws on the missing variable,
 * the raw string is returned, and the literal `{count}` token is what the
 * `.replace` finds. An override that turned `{count}` into `{count, number}`
 * would pass every name-based check and then render raw ICU to users. Types
 * matching means it cannot.
 */

import { IntlMessageFormat } from 'intl-messageformat';

import { intlTagForLocale, pluralCategoriesForLocale, type LocaleId } from './locales.js';

export type MessageValidationCode =
  | 'ICU_SYNTAX'
  | 'ARG_MISMATCH'
  | 'ARG_TYPE_MISMATCH'
  | 'PLURAL_MISMATCH'
  | 'PLURAL_CATEGORY'
  | 'PLURAL_MISSING_OTHER';

export interface MessageValidationError {
  code: MessageValidationCode;
  /** English, admin-facing; the editor shows it verbatim next to the field. */
  message: string;
}

export type MessageValidation = { ok: true } | { ok: false; errors: MessageValidationError[] };

/** Minimal @formatjs AST shape — mirrors the parity gate's walker. */
interface IcuNode {
  type: number;
  value?: unknown;
  options?: Record<string, { value: IcuNode[] }>;
  children?: IcuNode[];
}

interface MessageShape {
  /** `argName → ICU node type` (1 argument, 2 number, 3 date, 4 time, 5 select, 6 plural). */
  args: Map<string, number>;
  /** `argName → selector keywords`, for plural/selectordinal arguments only. */
  plurals: Map<string, string[]>;
}

function walk(nodes: IcuNode[], shape: MessageShape): void {
  for (const node of nodes) {
    if (node.type >= 1 && node.type <= 6 && typeof node.value === 'string') {
      shape.args.set(node.value, node.type);
    }
    if ((node.type === 5 || node.type === 6) && node.options !== undefined) {
      if (node.type === 6 && typeof node.value === 'string') {
        shape.plurals.set(node.value, Object.keys(node.options).sort());
      }
      for (const option of Object.values(node.options)) walk(option.value, shape);
    }
    if (node.children !== undefined) walk(node.children, shape);
  }
}

type ParseResult = { ok: true; shape: MessageShape } | { ok: false; reason: string };

/** Parse + extract, keeping the parser's reason so the admin gets a real message. */
function shapeOf(message: string, intlTag: string): ParseResult {
  const shape: MessageShape = { args: new Map(), plurals: new Map() };
  try {
    const ast = new IntlMessageFormat(message, intlTag, undefined, {
      ignoreTag: true,
    }).getAst() as IcuNode[];
    walk(ast, shape);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, shape };
}

/**
 * The parser rejects some things before the shape checks below can run — most
 * importantly a plural or select with no `other` branch, which it reports as
 * `MISSING_OTHER_CLAUSE`. Translating its machine reason into an admin-facing
 * sentence matters: "this is not valid ICU" tells someone editing German copy
 * nothing about which branch they forgot.
 */
function explainParseFailure(reason: string): MessageValidationError {
  if (reason.includes('MISSING_OTHER_CLAUSE')) {
    return {
      code: 'PLURAL_MISSING_OTHER',
      message:
        'Every plural and select needs an "other" branch — it is the fallback used when no other case matches.',
    };
  }
  if (reason.includes('CLOSING_BRACE') || reason.includes('EXPECT_ARGUMENT')) {
    return {
      code: 'ICU_SYNTAX',
      message: 'Unbalanced braces — every { needs a matching }.',
    };
  }
  return {
    code: 'ICU_SYNTAX',
    message: `This is not valid ICU MessageFormat (${reason}).`,
  };
}

const ARG_TYPE_NAMES: Readonly<Record<number, string>> = {
  1: 'plain',
  2: 'number',
  3: 'date',
  4: 'time',
  5: 'select',
  6: 'plural',
};

function typeName(type: number | undefined): string {
  return type === undefined ? 'absent' : (ARG_TYPE_NAMES[type] ?? `type ${String(type)}`);
}

export interface ValidateMessageOptions {
  /** The candidate override text an admin typed. */
  candidate: string;
  /** The en-US source this key is authored against. */
  source: string;
  /** Locale the candidate is for — supplies the Intl tag and plural categories. */
  locale: LocaleId;
  /**
   * Allow an empty candidate (the "render nothing" state, 23 §3.3). The
   * a11y-critical key check is the CALLER's — it needs the key, not the text.
   */
  allowEmpty?: boolean | undefined;
}

/**
 * Validate one admin-authored override against its en-US source.
 * Collects every failure rather than stopping at the first, so the editor can
 * show an admin all of what is wrong in one pass.
 */
export function validateMessage(opts: ValidateMessageOptions): MessageValidation {
  const { candidate, source, locale } = opts;
  const errors: MessageValidationError[] = [];

  // An empty override is the third state, not a malformed message.
  if (candidate === '') {
    return opts.allowEmpty === true
      ? { ok: true }
      : { ok: false, errors: [{ code: 'ICU_SYNTAX', message: 'This message may not be blank.' }] };
  }

  const intlTag = intlTagForLocale(locale);
  const parsed = shapeOf(candidate, intlTag);
  if (!parsed.ok) return { ok: false, errors: [explainParseFailure(parsed.reason)] };
  const candidateShape = parsed.shape;

  // The source is en-US by definition; parse it under en-US so a locale with
  // unusual plural rules cannot make a perfectly good source look invalid.
  const parsedSource = shapeOf(source, 'en-US');
  // A broken SOURCE is a repo bug, not an admin's fault — accept the override
  // rather than blocking an admin on something they cannot fix.
  if (!parsedSource.ok) return { ok: true };
  const sourceShape = parsedSource.shape;

  const sourceArgs = [...sourceShape.args.keys()].sort();
  const candidateArgs = [...candidateShape.args.keys()].sort();
  const missing = sourceArgs.filter((a) => !candidateShape.args.has(a));
  const extra = candidateArgs.filter((a) => !sourceShape.args.has(a));
  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing {${missing.join('}, {')}}`);
    if (extra.length > 0) parts.push(`unexpected {${extra.join('}, {')}}`);
    errors.push({
      code: 'ARG_MISMATCH',
      message: `Placeholders must match the English source exactly — ${parts.join('; ')}.`,
    });
  }

  // Argument TYPE parity — the literal-token guard (see the file header).
  for (const [name, sourceType] of sourceShape.args) {
    const candidateType = candidateShape.args.get(name);
    if (candidateType !== undefined && candidateType !== sourceType) {
      errors.push({
        code: 'ARG_TYPE_MISMATCH',
        message: `{${name}} must stay a ${typeName(sourceType)} placeholder — it was changed to ${typeName(candidateType)}.`,
      });
    }
  }

  // Plural parity is BIDIRECTIONAL, matching the compiled parity gate: an
  // override may neither drop a plural the source has nor invent one it does
  // not, because the call site's arguments are fixed by the source.
  const sourcePlurals = [...sourceShape.plurals.keys()].sort();
  const candidatePlurals = [...candidateShape.plurals.keys()].sort();
  if (sourcePlurals.join(',') !== candidatePlurals.join(',')) {
    errors.push({
      code: 'PLURAL_MISMATCH',
      message:
        sourcePlurals.length === 0
          ? `The English source has no plural, so this override may not add one (${candidatePlurals.join(', ')}).`
          : `Plural placeholders must match the English source exactly (expected ${sourcePlurals.join(', ') || 'none'}).`,
    });
  }

  // Every selector must be a category this locale actually has, and `other`
  // is mandatory — it is the branch ICU falls back to.
  const categories = new Set(pluralCategoriesForLocale(locale));
  for (const [name, selectors] of candidateShape.plurals) {
    const unknown = selectors.filter(
      (s) => !categories.has(s) && !s.startsWith('=') && s !== 'other',
    );
    if (unknown.length > 0) {
      errors.push({
        code: 'PLURAL_CATEGORY',
        message: `{${name}} uses plural categories this language does not have: ${unknown.join(', ')}. Available: ${[...categories].join(', ')}.`,
      });
    }
    if (!selectors.includes('other')) {
      errors.push({
        code: 'PLURAL_MISSING_OTHER',
        message: `{${name}} must include an "other" branch — it is the fallback every language needs.`,
      });
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
