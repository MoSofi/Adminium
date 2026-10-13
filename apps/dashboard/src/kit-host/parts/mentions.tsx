// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The mention text area, mounted on an app's own screen.
 *
 * It is the dashboard's own box (`MentionTextarea`), so what it stores is the
 * same: `@[Name](usr_…)` for each person, shown as `@Name` while it is typed.
 *
 * The box keeps what was typed. The app hears every change through `onChange`
 * and need not hand the value back; when it does give a new `value` (a form
 * cleared after a save), that is what the box then holds.
 */
import { MentionTextarea } from '@adminium/widgets/mentions';
import { useId, type ReactNode } from 'react';

import type { KitMounted, MentionsProps } from '../contract.js';
import { sessionPeople } from '../people.js';
import { mountReact } from '../root.js';

function MentionBox({ props, onStored, people }: { props: MentionsProps; onStored: (stored: string) => void; people: NonNullable<MentionsProps['people']> }): ReactNode {
  const id = useId();
  return (
    <div className="adm-kit-field">
      {props.label === undefined ? null : (
        <label className="adm-kit-label" htmlFor={id}>
          {props.label}
        </label>
      )}
      <MentionTextarea
        id={id}
        value={props.value}
        onChange={onStored}
        people={people}
        rows={props.rows ?? 3}
        placeholder={props.placeholder}
        disabled={props.disabled === true}
        error={props.invalid === true}
        {...(props.ariaLabel === undefined ? {} : { 'aria-label': props.ariaLabel })}
      />
    </div>
  );
}

export default function mountMentions(element: Element, props: MentionsProps): Promise<KitMounted<MentionsProps>> {
  const session = sessionPeople();
  return mountReact<MentionsProps>('mentions', element, props, (now, patch) => (
    <MentionBox
      props={now}
      people={now.people ?? session}
      onStored={(stored) => {
        patch({ value: stored });
        now.onChange(stored);
      }}
    />
  ));
}
