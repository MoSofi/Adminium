// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 1 — generation intent (Console comp "What do you need?"). Option
 * cards for the four intent variants; the comp's unimplemented 'split'
 * variant is deliberately dropped (ia-mapping defect list).
 *
 * Plus "Blank canvas", which the comp does not draw: connect the database and
 * generate nothing. Onboarding has offered it since 45 R3, and without it here
 * the only way to add a second database without a page per table was to
 * generate them and delete them again. It leads the grid, spans it, and is the
 * default, as in onboarding's `StartStep` (45 R3): generating is the choice an
 * operator makes, not the one they fall into by pressing Continue.
 */
import { BarChart3, Headset, LayoutDashboard, SquareDashed, Table2 } from 'lucide-react';
import { RadioGroup, RadioCard } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { WizardIntent } from '../wizardState.js';

interface IntentOption {
  value: WizardIntent;
  title: string;
  description: string;
  icon: React.ReactNode;
  /** Spans the grid — it is the one card that is not a generation template. */
  wide?: boolean;
}

export function IntentStep({
  value,
  onChange,
}: {
  value: WizardIntent;
  onChange: (intent: WizardIntent) => void;
}) {
  const options: IntentOption[] = [
    {
      value: 'blank',
      title: t('studio:intent.blank.title', 'Blank canvas'),
      description: t(
        'studio:intent.blank.description',
        'Generate nothing. Connect a database and build the pages you want, one at a time.',
      ),
      icon: <SquareDashed />,
      wide: true,
    },
    {
      value: 'full-admin',
      title: t('studio:intent.fullAdmin.title', 'Full admin panel'),
      description: t(
        'studio:intent.fullAdmin.description',
        'Dashboards, CRUD pages, search, imports and exports — everything your schema supports.',
      ),
      icon: <LayoutDashboard />,
    },
    {
      value: 'read-only-analytics',
      title: t('studio:intent.analytics.title', 'Read-only analytics'),
      description: t(
        'studio:intent.analytics.description',
        'Dashboards, charts and read-only grids. No forms, no writes — every role capped at Viewer.',
      ),
      icon: <BarChart3 />,
    },
    {
      value: 'crud',
      title: t('studio:intent.crud.title', 'CRUD tables'),
      description: t(
        'studio:intent.crud.description',
        'One editing page per table plus search and import/export — a minimal home, no dashboards.',
      ),
      icon: <Table2 />,
    },
    {
      value: 'support-console',
      title: t('studio:intent.support.title', 'Support console'),
      description: t(
        'studio:intent.support.description',
        'Queues, ticket and customer detail pages first. Deletes off by default. (Queue templates land in M7 — the v1 page set matches Full admin.)',
      ),
      icon: <Headset />,
    },
  ];

  return (
    <section aria-label={t('studio:intent.title', 'What do you need?')} className="flex flex-col gap-4">
      <div>
        <h2 className="text-section text-fg">{t('studio:intent.title', 'What do you need?')}</h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {t('studio:intent.subtitle', 'The intent shapes which pages get generated. You can change it later — changing it proposes a regeneration, never a silent rewrite.')}
        </p>
      </div>
      <RadioGroup
        aria-label={t('studio:intent.title', 'What do you need?')}
        value={value}
        onValueChange={(next) => onChange(next as WizardIntent)}
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
      <p className="text-caption text-fg-subtle">
        {t('studio:intent.trust', 'We read your schema only — never your row data during setup.')}
      </p>
    </section>
  );
}
