// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project's site templates, offered on the Designer's home: one is named in a sentence with
 * "Start from it"; several are listed, a folder whose name the Designer cannot take says to rename
 * it. "Start from it" puts the template with the message and writes "Make an app from {name}." in
 * the box, for the person to change and send. Why a folder was not copied in when the project was
 * made is said here once, until it is put away.
 */
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder, FolderX, Info, LayoutTemplate, X } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { designerApi, designerKeys, type SiteTemplates } from '../api.js';

function Mono({ children }: { children: string }): ReactNode {
  return (
    <span dir="auto" className="font-mono font-semibold">
      {children}
    </span>
  );
}

/** A sentence with one of its values set in the mono face. */
function named(text: string, name: string): ReactNode {
  const at = text.indexOf(name);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <Mono>{name}</Mono>
      {text.slice(at + name.length)}
    </>
  );
}

export function HomeTemplates({ started, onStart }: { started: string | null; onStart: (name: string) => void }): ReactNode {
  const queryClient = useQueryClient();
  const listed = useQuery({ queryKey: designerKeys.siteTemplates, queryFn: designerApi.siteTemplates, staleTime: 5_000, retry: false });
  return (
    <HomeTemplatesView
      listing={listed.data ?? null}
      started={started}
      onStart={onStart}
      onDismiss={() => {
        void designerApi.clearTemplateNote().finally(() => void queryClient.invalidateQueries({ queryKey: designerKeys.siteTemplates }));
      }}
    />
  );
}

/** The card and the note, from a listing: what the stories draw. */
export function HomeTemplatesView({ listing, started, onStart, onDismiss }: { listing: SiteTemplates | null; started: string | null; onStart: (name: string) => void; onDismiss: () => void }): ReactNode {
  const templates = listing?.templates ?? [];
  const note = listing?.note ?? null;
  const usable = templates.filter((entry) => entry.usable);
  const one = templates.length === 1 && usable.length === 1 ? usable[0] : undefined;
  // One template, once started: it is in the box now.
  const card = templates.length > 0 && !(one !== undefined && started === one.name);
  const start = 'shrink-0 whitespace-nowrap rounded-[10px] bg-accent-soft px-3.5 py-2 text-[13px] font-bold text-accent hover:brightness-95 focus-visible:outline-2 focus-visible:outline-accent';
  return (
    <>
      {note === null ? null : (
        <div role="status" className="mb-3 flex items-start gap-2.5 rounded-[14px] border border-info/25 bg-info-soft px-4 py-3 text-[13px] leading-normal" data-part="template-note">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
          <span className="min-w-0 flex-1 text-pretty">{named(t('designer:template.notCopied', '{name} was not copied in as a site template: {why}', { name: note.name, why: note.why }), note.name)}</span>
          <button
            type="button"
            aria-label={t('designer:template.dismiss', 'Dismiss')}
            className="flex size-[22px] shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
            onClick={onDismiss}
          >
            <X aria-hidden="true" className="size-[13px]" />
          </button>
        </div>
      )}
      {!card ? null : (
        <section aria-label={t('designer:template.listLabel', 'Site templates in this project')} className="mb-3 flex flex-col gap-1 rounded-[14px] border border-border bg-surface px-[18px] py-4 shadow-sm" data-part="home-templates">
          {one !== undefined ? (
            <div className="flex flex-wrap items-center gap-3">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                <LayoutTemplate className="size-4" />
              </span>
              <p className="m-0 min-w-0 flex-[1_1_260px] text-[13px] leading-normal">{named(t('designer:template.oneHere', 'There is a site template in this project: {name}.', { name: one.name }), one.name)}</p>
              <button type="button" className={start} onClick={() => onStart(one.name)}>
                {t('designer:template.startFromIt', 'Start from it')}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 pb-1.5">
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                  <LayoutTemplate className="size-4" />
                </span>
                <p className="m-0 text-[13px] leading-normal">{t('designer:template.severalHere', 'There are site templates in this project.')}</p>
              </div>
              <ul className="m-0 flex list-none flex-col p-0">
                {templates.map((entry) => (
                  <li key={entry.name} className="flex items-center gap-2.5 border-t border-border py-2.5">
                    {entry.usable ? (
                      <>
                        <Folder aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                        <span className="min-w-0 flex-1 text-[12.5px]">
                          <Mono>{entry.name}</Mono>
                        </span>
                        <button type="button" className={`${start} px-[13px] py-[7px] text-[12.5px]`} aria-label={t('designer:template.startFrom', 'Start from {name}', { name: entry.name })} onClick={() => onStart(entry.name)}>
                          {t('designer:template.startFromIt', 'Start from it')}
                        </button>
                      </>
                    ) : (
                      <>
                        <FolderX aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                        <span className="min-w-0 flex-1 text-pretty text-[12.5px] leading-normal text-fg-muted">{named(t('designer:template.rename', '{name}: rename this folder to use it (letters, digits, space, . _ -)', { name: entry.name }), entry.name)}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {(listing?.more ?? 0) > 0 ? <p className="m-0 pt-1 text-[12.5px] text-fg-muted">{t('designer:template.more', 'and {count} more', { count: listing?.more ?? 0 })}</p> : null}
            </>
          )}
        </section>
      )}
    </>
  );
}
