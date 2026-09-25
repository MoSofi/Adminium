// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "An app needs it" — the Add-ons page's dialog for uninstalling an add-on, or
 * switching it off for one app, when an installed app names it
 * (`Installed Apps.dc.html`, the add-on dialog in its three states).
 *
 *  - An app that REQUIRES it: refused, said before the click from the page's
 *    own "used by" read (and after it, from the server's 409
 *    `ADD_ON_REQUIRED_BY`, should the page be stale). The way out is named —
 *    uninstall that app first — and the only button closes.
 *  - An app that uses it for a FEATURE: allowed, after saying which feature
 *    stops, with a Cancel and a danger "… anyway".
 *
 * The "Used by" rows open each app's own settings page, where its add-ons are
 * listed. A switched-off app still holds its need, and says so in its row.
 */
import { Link } from '@tanstack/react-router';
import { Button, IconTile, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';
import { ArrowRight, Info, Lock, Package, Puzzle, Trash2, Unlink } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { NeedPill, featureWords, namesList } from '../apps/addOnWords.js';
import type { AddOnUse } from './addOnsApi.js';

export interface AddOnNeeded {
  /** Uninstalling the add-on, or switching it off for one app. */
  action: 'uninstall' | 'switch-off';
  addOn: { key: string; name: string; version: string };
  /** The apps in the way (refusal) or the apps whose features stop (warning). */
  uses: AddOnUse[];
  /** The app being switched off, for `switch-off`. */
  host?: string | undefined;
}

export function AddOnNeededDialog({
  needed,
  busy,
  onClose,
  onConfirm,
}: {
  needed: AddOnNeeded;
  busy: boolean;
  onClose: () => void;
  /** Present only for the feature warning: the click that goes ahead. */
  onConfirm?: (() => void) | undefined;
}) {
  const { addOn, uses, action } = needed;
  const refusal = uses.some((use) => use.need === 'requires');
  const requiring = uses.filter((use) => use.need === 'requires');
  const apps = namesList(requiring.map((use) => use.appName));
  const hostName = uses.find((use) => use.app === needed.host)?.appName ?? needed.host ?? '';

  const title = refusal
    ? action === 'uninstall'
      ? t('studio:addOnNeeded.title.uninstall', 'Uninstall {addOn}', { addOn: addOn.name })
      : t('studio:addOnNeeded.title.switchOff', 'Switch off for {app}', { app: hostName })
    : action === 'uninstall'
      ? t('studio:addOnNeeded.title.uninstallAsk', 'Uninstall {addOn}?', { addOn: addOn.name })
      : t('studio:addOnNeeded.title.switchOffAsk', 'Switch off for {app}?', { app: hostName });
  const subtitle =
    action === 'uninstall'
      ? t('studio:addOnNeeded.subtitle', 'v{version}', { version: addOn.version })
      : t('studio:addOnNeeded.subtitleNamed', '{addOn} · v{version}', { addOn: addOn.name, version: addOn.version });

  const lead = refusal
    ? action === 'uninstall'
      ? t('studio:addOnNeeded.lead.uninstall', '{addOn} can’t be uninstalled. {count, plural, one {{apps} needs it.} other {{apps} need it.}}', {
          addOn: addOn.name,
          apps,
          count: requiring.length,
        })
      : t('studio:addOnNeeded.lead.switchOff', '{addOn} can’t be switched off for {app}. {app} needs it.', { addOn: addOn.name, app: hostName })
    : uses
        .map((use) => t('studio:addOnNeeded.lead.feature', '{app}’s {features} will switch off.', { app: use.appName, features: featureWords(use.features) }))
        .join(' ');

  const note = refusal
    ? action === 'uninstall'
      ? t('studio:addOnNeeded.note.uninstall', 'To uninstall it, uninstall {apps} first.', { apps })
      : t('studio:addOnNeeded.note.switchOff', 'To switch it off, uninstall {app} first.', { app: hostName })
    : t('studio:addOnNeeded.note.feature', 'The rest of {apps} works without it.', { apps: namesList(uses.map((use) => use.appName)) });

  return (
    <Modal open onOpenChange={(next) => !next && !busy && onClose()}>
      <ModalHeader icon={<Puzzle />} tone="accent" title={title} subtitle={subtitle} closeLabel={t('studio:addOnNeeded.close', 'Close')} />
      <ModalBody>
        <div className="flex flex-col gap-3.5" data-testid="add-on-needed">
          <p className="text-[13px] font-semibold leading-[1.55] text-fg">{lead}</p>
          <div className="overflow-hidden rounded-[12px] border border-border">
            <div className="bg-surface-2 px-3.5 py-[9px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-fg-subtle">
              {t('studio:addOnNeeded.usedBy', 'Used by')}
            </div>
            <ul>
              {(refusal ? requiring : uses).map((use) => (
                <li key={use.app} className="flex flex-wrap items-center gap-[11px] border-t border-border px-3.5 py-[11px]">
                  <IconTile size="sm" icon={<Package />} />
                  <div className="min-w-[140px] flex-1">
                    <div className="flex flex-wrap items-center gap-[7px]">
                      <span className="text-[12.5px] font-bold">{use.appName}</span>
                      <NeedPill need={use.need} features={use.features} />
                    </div>
                    {use.status === 'installed' ? null : (
                      <p className="mt-0.5 text-[11.5px] text-fg-subtle">
                        {use.status === 'disabled'
                          ? t('studio:addOnNeeded.appDisabled', 'Switched off — it still needs it')
                          : t('studio:addOnNeeded.appInstalling', 'Its install has not finished — it still needs it')}
                      </p>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" asChild>
                    <Link to="/studio/apps/$key" params={{ key: use.app }}>
                      {t('studio:addOnNeeded.openApp', 'Open {app}', { app: use.appName })}
                      <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex gap-[11px] rounded-[12px] bg-surface-3 px-[15px] py-[13px]">
            {refusal ? (
              <Lock aria-hidden className="mt-px size-4 shrink-0 text-fg-muted" />
            ) : (
              <Info aria-hidden className="mt-px size-4 shrink-0 text-fg-muted" />
            )}
            <p className="text-[12.5px] leading-[1.5] text-fg-muted">{note}</p>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        {refusal || onConfirm === undefined ? (
          <Button variant="secondary" onClick={onClose}>
            {t('studio:addOnNeeded.close', 'Close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              {t('studio:addOns.confirm.cancel', 'Cancel')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={onConfirm}>
              {action === 'uninstall' ? <Trash2 aria-hidden className="size-[15px]" /> : <Unlink aria-hidden className="size-[15px]" />}
              {action === 'uninstall'
                ? t('studio:addOnNeeded.confirm.uninstall', 'Uninstall anyway')
                : t('studio:addOnNeeded.confirm.switchOff', 'Switch it off anyway')}
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
