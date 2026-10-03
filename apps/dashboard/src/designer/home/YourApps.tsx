// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Your apps" on Designer Home: every app of the project folder, with the
 * newest session that built it. "Continue" opens that session; an app no
 * session built (copied in, or made by hand) gets a new session, with no
 * first message, on the model in use.
 */
import type { ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Boxes } from 'lucide-react';

import { ApiError } from '../../app/api.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { designerApi, type YourApp } from '../api.js';
import type { PickedModel } from '../models/useModel.js';

const STEPS: { limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 60_000, divisor: 1000, unit: 'second' },
  { limit: 3_600_000, divisor: 60_000, unit: 'minute' },
  { limit: 86_400_000, divisor: 3_600_000, unit: 'hour' },
  { limit: 7 * 86_400_000, divisor: 86_400_000, unit: 'day' },
  { limit: 30 * 86_400_000, divisor: 7 * 86_400_000, unit: 'week' },
  { limit: 365 * 86_400_000, divisor: 30 * 86_400_000, unit: 'month' },
];

/** "3 minutes ago", "yesterday", in the page's language. */
export function editedWhen(at: number, now = Date.now(), locale = getI18nInstance()?.language ?? 'en-US'): string {
  const delta = at - now;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const step of STEPS) {
    if (Math.abs(delta) < step.limit) return format.format(Math.round(delta / step.divisor), step.unit);
  }
  return format.format(Math.round(delta / (365 * 86_400_000)), 'year');
}

export function YourApps({ apps, model, target }: { apps: YourApp[]; model: PickedModel | null; target: 'auto' | 'dashboard' | 'web' }): ReactNode {
  const navigate = useNavigate();
  const toasts = useAppToasts();
  const open = useMutation({
    mutationFn: async (app: YourApp) => {
      if (app.sessionId !== null) return app.sessionId;
      if (model === null) throw new Error(t('designer:home.noModel', 'Adminium Designer uses your own AI model. Add one to begin.'));
      const created = await designerApi.createSession({ appKey: app.key, target, connectionId: model.connectionId, model: model.model });
      return created.session.id;
    },
    onSuccess: async (sessionId) => {
      await navigate({ to: '/design/$sessionId', params: { sessionId } });
    },
    onError: (error) => {
      toasts.push({ variant: 'error', title: t('designer:home.failed', 'The Designer could not start'), description: error instanceof ApiError || error instanceof Error ? error.message : String(error) });
    },
  });

  return (
    <section aria-labelledby="designer-your-apps" className="mt-[clamp(48px,5.5vw,80px)] w-full">
      <h2 id="designer-your-apps" className="m-0 mb-3.5 text-lg font-extrabold tracking-tight">
        {t('designer:apps.title', 'Your apps')}
      </h2>
      <ul className="m-0 list-none overflow-hidden rounded-[14px] border border-border bg-surface p-0 shadow-sm">
        {apps.map((app) => (
          <li key={app.key} className="flex flex-wrap items-center gap-x-3.5 gap-y-3 border-t border-border px-[18px] py-3.5 first:border-t-0 max-sm:px-4 max-sm:py-[11px]">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
              <Boxes className="size-[17px]" />
            </span>
            <div className="flex min-w-0 flex-[1_1_220px] flex-wrap items-center gap-x-3.5 gap-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-bold">{app.name}</span>
                <span className="rounded-md bg-surface-3 px-[7px] py-0.5 font-mono text-[11.5px] font-semibold text-fg-muted">{app.key}</span>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap text-[12.5px] text-fg-muted">
                {app.version === null ? (
                  <span>{t('designer:apps.noVersions', 'No versions yet')}</span>
                ) : (
                  <span>{t('designer:apps.versions', '{count, plural, one {# version} other {# versions}}', { count: app.version })}</span>
                )}
                {app.editedAt === null ? null : (
                  <>
                    <span aria-hidden="true" className="text-fg-subtle">
                      ·
                    </span>
                    <span>{t('designer:apps.edited', 'Edited {when}', { when: editedWhen(app.editedAt) })}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              disabled={open.isPending || (app.sessionId === null && model === null)}
              onClick={() => open.mutate(app)}
              aria-label={t('designer:apps.continueApp', 'Continue {name}', { name: app.name })}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-surface px-3 py-2 text-[12.5px] font-bold text-fg hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('designer:apps.continue', 'Continue')}
              <ArrowRight aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
