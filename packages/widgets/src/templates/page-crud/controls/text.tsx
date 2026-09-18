// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The text family (Appendix C, comp 145, 190, 201, 202, 210, 224, 245).
 *
 * Six controls over the same two columns of the catalog, and the differences
 * are all about what the person is typing rather than what the column stores:
 * a title is the line the dialog is named after, a mono input is a code you
 * read character by character, a phone carries a prefix that is stored WITH the
 * number (D29), a password only masks what is being typed (D28 — it hashes
 * nothing and makes no column secret).
 */
import { Input, InputGroup, Textarea } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import type { ControlProps } from './types.js';

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The shared props every plain input takes from the field's own settings. */
function inputProps(props: ControlProps) {
  const { column, field, error, disabled, id } = props;
  return {
    ...(id === undefined ? {} : { id }),
    ...(props['aria-label'] === undefined ? {} : { 'aria-label': props['aria-label'] }),
    ...(props['aria-describedby'] === undefined ? {} : { 'aria-describedby': props['aria-describedby'] }),
    ...(props['aria-invalid'] === undefined ? {} : { 'aria-invalid': props['aria-invalid'] }),
    ...(props['aria-required'] === undefined ? {} : { 'aria-required': props['aria-required'] }),
    ...(error === true ? { error: true as const } : {}),
    ...(disabled === true ? { disabled: true as const } : {}),
    ...(field?.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    ...(column.maxLength === null || column.maxLength === undefined ? {} : { maxLength: column.maxLength }),
    /*
     * SPELLED OUT, not left to the DOM's default.
     *
     * An `<input>` with no `type` attribute behaves as a text box, so dropping
     * it changes nothing a person sees — and everything a selector sees:
     * `input[type="text"]` matches an ATTRIBUTE, and anything looking for the
     * form's text fields by that (a test, a stylesheet, an extension) finds
     * none. The sibling controls all name their type; this one is a text box
     * and says so.
     */
    type: 'text' as const,
  };
}

export function TextControl(props: ControlProps) {
  return (
    <Input
      {...inputProps(props)}
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

/** The quick dialog's first field: the same input, given room (comp 145). */
export function TitleControl(props: ControlProps) {
  return (
    <Input
      {...inputProps(props)}
      className="h-[42px] text-[14px] font-semibold"
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

/** Ids, codes, anything read character by character (comp 210, 245). */
export function MonoControl(props: ControlProps) {
  return (
    <Input
      {...inputProps(props)}
      mono
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

export function EmailControl(props: ControlProps) {
  return (
    <Input
      {...inputProps(props)}
      type="email"
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

export function UrlControl(props: ControlProps) {
  return (
    <Input
      {...inputProps(props)}
      type="url"
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

/**
 * Phone, with the prefix STORED WITH THE NUMBER (D29, comp 201).
 *
 * With prefix `+1` and input `(555) 000-0000` the column holds
 * `+1 (555) 000-0000`, and on edit the prefix is split back off so the field
 * shows what the person typed. Keeping the prefix out of the value would
 * store a number nobody can dial; keeping it in the field would make every
 * edit re-type it.
 *
 * A per-entry country picker is not drawn and is refused — the prefix is
 * a FIELD setting, the same for every row of the column.
 */
export function PhoneControl(props: ControlProps) {
  const prefix = props.field?.prefix;
  const stored = asText(props.value);
  const local =
    prefix !== undefined && stored.startsWith(prefix) ? stored.slice(prefix.length).trimStart() : stored;
  return (
    <InputGroup
      {...inputProps(props)}
      type="tel"
      {...(prefix === undefined ? {} : { prefix })}
      value={local}
      onChange={(event) => {
        const next = event.target.value;
        if (next === '') {
          props.onChange('');
          return;
        }
        props.onChange(prefix === undefined ? next : `${prefix} ${next}`);
      }}
    />
  );
}

/**
 * A password field that MASKS TYPING and nothing else (D28, F6).
 *
 * It does not hash (O1), it does not make the column secret, and it is never a
 * default — a secret column stays out of every form and is unwritable, which is
 * a server fact this control cannot and must not change. What it gives is the
 * one thing the comp asks for: a value nobody reads over your shoulder.
 */
export function PasswordControl(props: ControlProps) {
  const t = useMaybeT();
  const [revealed, setRevealed] = useState(false);
  return (
    <InputGroup
      {...inputProps(props)}
      type={revealed ? 'text' : 'password'}
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
      trailing={
        <button
          type="button"
          className="nb-ib inline-flex size-6 items-center justify-center rounded-md text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label={
            revealed
              ? t('ui:formDialog.control.hide', 'Hide')
              : t('ui:formDialog.control.reveal', 'Show')
          }
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? (
            <EyeOff className="size-3.5" aria-hidden="true" />
          ) : (
            <Eye className="size-3.5" aria-hidden="true" />
          )}
        </button>
      }
    />
  );
}

/** Rows 2–4 depending on how much of the form this text IS (comp 224, 462). */
export function TextareaControl(props: ControlProps) {
  return (
    <Textarea
      {...inputProps(props)}
      rows={3}
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

/** JSON is a textarea in mono: it is text the person is responsible for. */
export function JsonControl(props: ControlProps) {
  return (
    <Textarea
      {...inputProps(props)}
      rows={5}
      className="font-mono text-[12.5px]"
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}
