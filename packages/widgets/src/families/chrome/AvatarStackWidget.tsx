/**
 * `avatar-stack` (annex §11) — overlapping gradient-initials avatars with a
 * "+N" overflow bubble; presence variant adds online dots + an online-count
 * caption. Evidence: Adminium Dashboard (team presence), Scheduled Reports,
 * Project Board, Vision Board, Auth & Onboarding (social proof).
 *
 * Wraps @adminium/ui's `AvatarStack` + `Avatar`, which already own the −8px
 * logical overlap (`-ms-2`, so it mirrors correctly in RTL), the 2px surface
 * ring, and the hash-picked initials gradient; this file adds the record-list
 * binding and the presence caption.
 */

import { Avatar, AvatarStack } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { booleanField, recordRowsOf, stringField } from './chrome-lib.js';
import { avatarStackConfigSchema, avatarStackDemoData } from './chrome-config.js';
import type { AvatarStackConfig } from './chrome-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { avatarStackConfigSchema, avatarStackDemoData };
export type { AvatarStackConfig };

export interface Person {
  key: string;
  /**
   * The display name. @adminium/ui's `Avatar` derives BOTH the initials and the
   * deterministic gradient from this one string, so there is no separate
   * initials value to carry: a table that stores only initials simply points
   * `nameField` at that column and gets the same rendering.
   */
  name: string;
  imageUrl?: string | undefined;
  online?: boolean | undefined;
}

/** Project the §3 `record-list` payload onto people. */
export function peopleOf(data: unknown, config: AvatarStackConfig): Person[] {
  const rows = recordRowsOf(data);
  const out: Person[] = [];
  for (const [index, row] of rows.entries()) {
    // Prefer an explicit initials column when the schema has one; else the name.
    const name = stringField(row, config.nameField) ?? stringField(row, config.initialsField);
    if (name === undefined) continue;
    out.push({
      key: `${name}-${index}`,
      name,
      imageUrl: stringField(row, config.imageField),
      online: booleanField(row, config.onlineField),
    });
  }
  return out;
}

export function AvatarStackWidget({ config, data }: WidgetProps<AvatarStackConfig>) {
  const t = useMaybeT();
  const people = peopleOf(data, config);
  if (people.length === 0) return null;

  const onlineCount = people.filter((person) => person.online === true).length;

  return (
    <div
      data-widget="avatar-stack"
      data-testid={config.testId}
      className="flex h-full flex-col justify-center gap-1 px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <AvatarStack max={config.max} size={config.size} label={config.title ?? t('ui:widgets.chrome.avatarStack.a11yLabel', 'People')}>
        {people.map((person) => (
          <Avatar
            key={person.key}
            size={config.size}
            name={person.name}
            {...(person.imageUrl === undefined ? {} : { src: person.imageUrl })}
            // The dot renders only when `presence` is set, so the non-presence
            // variant gets it as `undefined` rather than a falsy tone.
            {...(config.presence && person.online === true ? { presence: 'pos' as const } : {})}
          />
        ))}
      </AvatarStack>
      {config.presence && (
        <p data-part="presence-caption" className="text-caption text-fg-subtle">
          {config.onlineLabel !== undefined
            ? config.onlineLabel.replace('{count}', String(onlineCount))
            : t('ui:widgets.chrome.avatarStack.online', '{count} online', { count: onlineCount })}
        </p>
      )}
    </div>
  );
}
