// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 1 — what will you build first? (45-onboarding.md §2, comp step
 * "Choose a starting point", renamed by the owner.)
 *
 * WHY THESE FIVE. The comp draws Ops dashboard / CRM / Analytics / Blank
 * canvas. Three of those describe a starter-template system that exists nowhere
 * in this product (45 §0.4, DEP-3). What does exist is the connect wizard's
 * generation intent, which really does change the pages you end up with — so
 * the four real intents are the four cards, with Blank canvas first and
 * selected, per the owner's ruling (45 R3).
 *
 * The copy is written fresh rather than imported from `studio:intent.*`: that
 * namespace is lazily loaded for the Studio, and nothing outside `src/studio`
 * may read one of its keys without dragging it into the first-run chunk.
 *
 * No heading: the shell already renders the step's title and description above
 * this body, exactly as the comp lays it out.
 */
import { BarChart3, Headset, LayoutDashboard, SquareDashed, Table2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { RadioCard, RadioGroup } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { OnboardingStart } from '../heldAnswers.js';

interface StartOption {
  value: OnboardingStart;
  title: string;
  description: string;
  icon: ReactNode;
  /** The default spans the grid — it is the answer, not one of four peers. */
  wide?: boolean;
}

export interface StartStepProps {
  value: OnboardingStart;
  onChange: (value: OnboardingStart) => void;
}

export function StartStep({ value, onChange }: StartStepProps) {
  const options: StartOption[] = [
    {
      value: 'blank',
      title: t('onboarding:start.options.blank.title', 'Blank canvas'),
      description: t(
        'onboarding:start.options.blank.body',
        'Generate nothing. Connect a database and build the pages you want, one at a time.',
      ),
      icon: <SquareDashed />,
      wide: true,
    },
    {
      value: 'full-admin',
      title: t('onboarding:start.options.fullAdmin.title', 'Full admin panel'),
      description: t(
        'onboarding:start.options.fullAdmin.body',
        'A page per table, with create, edit and delete.',
      ),
      icon: <LayoutDashboard />,
    },
    {
      value: 'read-only-analytics',
      title: t('onboarding:start.options.analytics.title', 'Read-only analytics'),
      description: t(
        'onboarding:start.options.analytics.body',
        'Charts and tables to read. Nothing writes back.',
      ),
      icon: <BarChart3 />,
    },
    {
      value: 'crud',
      title: t('onboarding:start.options.crud.title', 'CRUD tables'),
      description: t(
        'onboarding:start.options.crud.body',
        'Tables and forms, without the dashboards.',
      ),
      icon: <Table2 />,
    },
    {
      value: 'support-console',
      title: t('onboarding:start.options.support.title', 'Support console'),
      description: t(
        'onboarding:start.options.support.body',
        'Queues and customer detail pages first, with deletes off.',
      ),
      icon: <Headset />,
    },
  ];

  return (
    <RadioGroup
      aria-label={t('onboarding:start.title', 'What will you build first?')}
      value={value}
      onValueChange={(next) => onChange(next as OnboardingStart)}
      className="grid gap-2.5 sm:grid-cols-2"
    >
      {options.map((option) => (
        <RadioCard
          key={option.value}
          value={option.value}
          title={option.title}
          description={option.description}
          icon={option.icon}
          {...(option.wide === true ? { className: 'sm:col-span-2' } : {})}
        />
      ))}
    </RadioGroup>
  );
}
