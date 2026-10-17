// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A text box in which people are mentioned.
 *
 * Typing `@` and a letter or two offers the people who may be named, under
 * the box; the arrow keys move through them, Enter or Tab or a click takes
 * one, Escape puts the list away. What the box shows is `@Name`; what it
 * hands to `onChange` is the text as it is stored, each person by their id.
 */
import { Textarea } from '@adminium/ui';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';

import { useMaybeT } from '../../lib/i18n.js';
import { mentionQueryAt, shownOf, storedOf, withMention, type MentionPerson } from './mentions.js';
import { usePeopleSource, type PeopleSource } from './people-source.js';

export interface MentionTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'defaultValue' | 'className' | 'style'> {
  /** The text as it is stored. */
  value: string;
  /** The text as it is to be stored. */
  onChange: (stored: string) => void;
  error?: boolean | undefined;
  autoResize?: boolean | undefined;
  /** Who may be named; the host's own when absent. */
  people?: PeopleSource | undefined;
}

export function MentionTextarea({ value, onChange, people: given, error, autoResize, onKeyDown, onBlur, ...rest }: MentionTextareaProps) {
  const t = useMaybeT();
  const hosts = usePeopleSource();
  const source = given ?? hosts;
  const listId = useId();
  const box = useRef<HTMLTextAreaElement | null>(null);
  // Who each `@Name` in the box is: those the stored text came with, and those picked since.
  const known = useRef(new Map<string, string>());
  const shown = useMemo(() => {
    const { text, people } = shownOf(value);
    for (const [name, id] of people) known.current.set(name, id);
    return text;
  }, [value]);

  const [asking, setAsking] = useState<{ from: number; query: string } | null>(null);
  const [found, setFound] = useState<readonly MentionPerson[]>([]);
  const [active, setActive] = useState(0);
  const caretAfter = useRef<number | null>(null);

  useEffect(() => {
    if (asking === null || source === null || asking.query.trim() === '') {
      setFound([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      source(asking.query.trim())
        .then((list) => {
          if (stale) return;
          setFound(list.slice(0, 8));
          setActive(0);
        })
        .catch(() => {
          if (!stale) setFound([]);
        });
    }, 120);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [asking, source]);

  // After a pick the caret goes behind the name, once the new text is in the box.
  useEffect(() => {
    if (caretAfter.current === null || box.current === null) return;
    box.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [shown]);

  const open = asking !== null && found.length > 0;

  const take = (person: MentionPerson): void => {
    if (asking === null) return;
    known.current.set(person.name, person.id);
    const next = withMention(shown, asking, person);
    caretAfter.current = next.caret;
    setAsking(null);
    setFound([]);
    onChange(storedOf(next.text, known.current));
    box.current?.focus();
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        take(found[active]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setAsking(null);
        return;
      }
    }
    onKeyDown?.(event);
  };

  return (
    <div className="relative w-full">
      <Textarea
        {...rest}
        ref={box}
        className="w-full"
        {...(error === true ? { error: true } : {})}
        {...(autoResize === true ? { autoResize: true } : {})}
        value={shown}
        role={source === null ? undefined : 'combobox'}
        aria-autocomplete={source === null ? undefined : 'list'}
        aria-expanded={source === null ? undefined : open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${String(active)}` : undefined}
        onChange={(event) => {
          const text = event.target.value;
          setAsking(source === null ? null : mentionQueryAt(text, event.target.selectionStart ?? text.length));
          onChange(storedOf(text, known.current));
        }}
        onKeyDown={keyDown}
        onBlur={(event) => {
          setAsking(null);
          onBlur?.(event);
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('ui:mentions.people', 'People to mention')}
          data-testid="mention-list"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-[220px] overflow-auto rounded-[10px] border border-border bg-surface p-1 shadow-md"
        >
          {found.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${String(index)}`}
              role="option"
              aria-selected={index === active}
              // Before the box loses its focus: a click that blurred first would find the list gone.
              onMouseDown={(event) => {
                event.preventDefault();
                take(person);
              }}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer rounded-[7px] px-2.5 py-1.5 text-body-sm ${index === active ? 'bg-surface-raised text-fg' : 'text-fg-muted'}`}
            >
              {person.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
