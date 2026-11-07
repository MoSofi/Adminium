// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: the quick save — one dialog, the quick install's pattern
 * (`HostedAppsPage`'s quick install).
 *
 * Everything on the database goes in, without rows. The dialog shows what
 * the file would hold and how many things need the person; that count is the
 * Check step's own (blocks saving + needs a choice), from the same plan of
 * the same draft. With nothing open, Save saves and lands on the Download
 * step, so the fingerprint is always shown; otherwise "Review choices" opens
 * Check.
 */
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Alert, Button, FormField, Input, Modal, ModalBody, ModalHeader, MonoText, Spinner } from '@adminium/ui';
import { useState, type ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import type { SaveFlowShared } from './saveAppShared.js';
import { groupCheck, needsCount, personalViews, unansweredViewItems } from './saveAppDraft.js';
import { checkSentence, monoSentence, problemSentence, saveErrorText } from './saveAppWords.js';
import { aboutProblems, nextVersionFor } from './saveAppAbout.js';

export interface QuickSaveDialogProps extends SaveFlowShared {
  onMoreChoices: () => void;
  onReview: () => void;
}

export function QuickSaveDialog(props: QuickSaveDialogProps) {
  const { draft, setDraft, inventory, plan, planPending, planError, saving, saveError, onClose, databases, connectionId, saves } = props;
  const [showAll, setShowAll] = useState(false);
  const database = databases.find((one) => one.connection.id === connectionId)?.connection.name ?? '';
  const views = inventory === undefined || draft === null ? [] : personalViews(inventory, draft);
  const problems = draft === null ? null : aboutProblems(draft, saves, connectionId, props.catalogKeys);
  const counts = plan?.counts ?? {};
  const needs = plan === undefined ? null : needsCount(plan, views);
  const open = needs === null ? 0 : needs.blocks + needs.choices;
  const ready = plan !== undefined && plan.ready && !planPending;
  const groups = plan === undefined ? null : groupCheck(plan);
  const summaries: ReactNode[] = [
    ...(plan?.problems ?? []).map((problem) => problemSentence(problem)),
    ...(plan === undefined || groups === null ? [] : [...groups.blocks, ...groups.choices, ...unansweredViewItems(plan, views)].map((item) => checkSentence(item))),
  ].slice(0, 2);
  const more = (counts['emailTemplates'] ?? 0) + (counts['documents'] ?? 0) + (counts['reports'] ?? 0) + (counts['invoiceLayouts'] ?? 0) + (counts['scheduledReports'] ?? 0);

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <ModalHeader
        title={t('studio:saveApp.quick.title', 'Save {database} as an app', { database })}
        closeLabel={t('studio:saveApp.cancel', 'Cancel')}
      />
      <ModalBody className="flex flex-col gap-4 pb-0 leading-[normal]">
        <p className="text-[13px] leading-[1.5] text-fg-muted">
          {monoSentence(
            (m) => t('studio:saveApp.quick.body', 'Everything on {database} goes in, without rows. Nothing on this server changes.', { database: m['database']! }),
            { database },
          )}
        </p>

        {draft === null ? (
          inventoryErrorOrLoading(props)
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_120px]">
              <FormField label={t('studio:saveApp.about.name', 'Name')} controlId="quick-save-name" error={problems?.name}>
                <Input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </FormField>
              <FormField label={t('studio:saveApp.about.key', 'Key')} controlId="quick-save-key" error={problems?.key}>
                <Input className="font-mono" value={draft.key} maxLength={80} onChange={(event) => setDraft({ ...draft, key: event.target.value.trim() })} />
              </FormField>
              <FormField label={t('studio:saveApp.about.version', 'Version')} controlId="quick-save-version" error={problems?.version}>
                <Input
                  className="font-mono"
                  value={draft.version ?? nextVersionFor(draft.key, saves)}
                  onChange={(event) => setDraft({ ...draft, version: event.target.value.trim() })}
                />
              </FormField>
            </div>

            {plan === undefined ? null : (
              <div className="flex flex-col gap-2 text-[13px]">
                <p>
                  {t(
                    'studio:saveApp.quick.summary',
                    '{tables, plural, one {# table} other {# tables}}, {pages, plural, one {# page} other {# pages}}, {roles, plural, one {# role} other {# roles}}, {automations, plural, one {# automation} other {# automations}} and {more, plural, one {# more thing} other {# more things}}.',
                    { tables: counts['tables'] ?? 0, pages: counts['pages'] ?? 0, roles: counts['roles'] ?? 0, automations: counts['automations'] ?? 0, more },
                  )}{' '}
                  <button
                    type="button"
                    className="font-bold text-accent underline underline-offset-[3px]"
                    aria-expanded={showAll}
                    aria-controls="quick-save-all"
                    onClick={() => setShowAll(!showAll)}
                  >
                    {showAll ? t('studio:saveApp.quick.hide', 'Hide them') : t('studio:saveApp.quick.show', 'Show them')}
                  </button>
                </p>
                {showAll ? (
                  <div id="quick-save-all" className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                      {(
                        [
                          ['tables', t('studio:saveApp.group.tables', 'Tables')],
                          ['pages', t('studio:saveApp.group.pages', 'Pages')],
                          ['roles', t('studio:saveApp.group.roles', 'Roles')],
                          ['automations', t('studio:saveApp.group.automations', 'Automations')],
                          ['emailTemplates', t('studio:saveApp.group.emailTemplates', 'Email templates')],
                          ['documents', t('studio:saveApp.group.documents', 'Documents')],
                          ['reports', t('studio:saveApp.group.reports', 'Reports')],
                          ['invoiceLayouts', t('studio:saveApp.group.invoiceLayouts', 'Invoice layouts')],
                          ['scheduledReports', t('studio:saveApp.group.scheduledReports', 'Scheduled reports')],
                        ] as const
                      ).map(([kind, label]) => (
                        <div key={kind} className="flex items-center justify-between gap-2">
                          <dt className="text-fg-muted">{label}</dt>
                          <dd>
                            <MonoText>{counts[kind] ?? 0}</MonoText>
                          </dd>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-fg-muted">{t('studio:saveApp.group.views', 'Saved views')}</dt>
                        <dd>
                          <MonoText>{t('studio:saveApp.views.shared', '{shared} of {total}', { shared: views.filter((view) => draft.sharedViews.includes(view.id)).length, total: views.length })}</MonoText>
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-fg-muted">{t('studio:saveApp.group.publicEndpoints', 'Public access')}</dt>
                        <dd>
                          <MonoText>{counts['publicAccess'] ?? 0}</MonoText>
                        </dd>
                      </div>
                    </dl>
                    {views.length === 0 ? null : (
                      <p className="text-xs text-fg-subtle">{t('studio:saveApp.quick.viewsNote', 'Saved views belong to people, so none go in until they are shared.')}</p>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            <div role="status" aria-live="polite" className="flex flex-col gap-1 text-[13px]">
              {planPending || (plan === undefined && planError === null && problems === null) ? (
                <span className="inline-flex items-center gap-2 text-fg-muted">
                  <Spinner size="sm" />
                  {t('studio:saveApp.quick.checking', 'Checking what the file would hold…')}
                </span>
              ) : plan === undefined ? null : open === 0 ? (
                <span data-part="quick-ready" className="inline-flex items-center gap-2 font-bold text-pos">
                  <CircleCheck aria-hidden className="size-4" />
                  {t('studio:saveApp.quick.ready', 'Ready to save')}
                </span>
              ) : (
                <>
                  <span data-part="quick-needs" className="inline-flex items-center gap-2 font-bold text-warn">
                    <TriangleAlert aria-hidden className="size-4" />
                    {t('studio:saveApp.quick.needs', '{count, plural, one {# thing needs a choice} other {# things need a choice}}', { count: open })}
                  </span>
                  <span className="text-fg-muted">
                    {summaries.map((summary, index) => (
                      <span key={index}>
                        {index > 0 ? ' · ' : null}
                        {summary}
                      </span>
                    ))}
                    {views.length > 0 && summaries.length < 2 ? (
                      <span>
                        {summaries.length > 0 ? ' · ' : null}
                        {t('studio:saveApp.quick.viewsNeed', '{count, plural, one {# saved view belongs to a person} other {# saved views belong to people}}', { count: views.length })}
                      </span>
                    ) : null}
                  </span>
                </>
              )}
            </div>
            {planError === null ? null : (
              <Alert tone="danger" title={t('studio:saveApp.planFailed', 'The file could not be checked')}>
                {saveErrorText(planError)}
              </Alert>
            )}
            {saveError === null ? null : (
              <Alert tone="danger" role="alert" title={t('studio:saveApp.saveFailed', 'Could not save. Nothing was written. Try again.')}>
                {saveErrorText(saveError)}
              </Alert>
            )}
          </>
        )}

        <footer className="sticky bottom-0 -mx-5 mt-1 flex flex-col-reverse gap-2 border-t border-border bg-surface px-5 py-3.5 sm:flex-row sm:items-center">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t('studio:saveApp.cancel', 'Cancel')}
          </Button>
          <span className="flex flex-col-reverse gap-2 sm:ms-auto sm:flex-row">
            <Button variant="secondary" disabled={saving || draft === null} onClick={props.onMoreChoices}>
              {t('studio:saveApp.quick.more', 'More choices')}
            </Button>
            {plan !== undefined && !ready && !planPending ? (
              <Button onClick={props.onReview}>{t('studio:saveApp.quick.review', 'Review choices')}</Button>
            ) : (
              <Button loading={saving} disabled={!ready || problems !== null} onClick={props.save}>
                {t('studio:saveApp.save', 'Save')}
              </Button>
            )}
          </span>
        </footer>
      </ModalBody>
    </Modal>
  );
}

function inventoryErrorOrLoading(props: Pick<SaveFlowShared, 'inventoryError'>) {
  if (props.inventoryError !== null) {
    return (
      <Alert tone="danger" title={t('studio:saveApp.inventoryFailed', 'This database could not be read for saving')}>
        {saveErrorText(props.inventoryError)}
      </Alert>
    );
  }
  return (
    <p className="inline-flex items-center gap-2 text-[13px] text-fg-muted">
      <Spinner size="sm" />
      {t('studio:saveApp.loading', 'Reading the database…')}
    </p>
  );
}

