// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A site template in the message box: its chip ("harbor-bakery · 9 pages · 64 files", and what was
 * left out, each with why), the chip while it goes up (with its percent, and Cancel), the sentence it
 * was refused with, and the question a second site asks before it replaces the first.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { CircleAlert, FileArchive, FileX, LayoutTemplate, LoaderCircle, X } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { LeftOutReason } from '../api.js';
import type { SiteControl } from './siteState.js';

/** A sentence with one of its values set in the mono face, as the comps draw names. */
function withName(text: string, name: string): ReactNode {
  const at = text.indexOf(name);
  if (at < 0 || name === '') return text;
  return (
    <>
      {text.slice(0, at)}
      <span dir="auto" className="font-mono font-semibold">
        {name}
      </span>
      {text.slice(at + name.length)}
    </>
  );
}

/** Why a file was left out, in the person's words. */
export function leftOutWhy(reason: LeftOutReason): string {
  switch (reason) {
    case 'php':
      return t('designer:template.why.php', 'PHP is not used');
    case 'video':
      return t('designer:template.why.video', 'videos are not kept');
    case 'sound':
      return t('designer:template.why.sound', 'sounds are not kept');
    case 'scss':
      return t('designer:template.why.scss', 'SCSS and Less are not used; their CSS is');
    case 'map':
      return t('designer:template.why.map', 'source maps are not kept');
    case 'zip':
      return t('designer:template.why.zip', 'a zip inside the template is not opened');
    case 'source':
      return t('designer:template.why.source', 'source code that needs a build is not used');
    case 'build-file':
      return t('designer:template.why.buildFile', 'build files are not used');
    case 'build-folder':
      return t('designer:template.why.buildFolder', 'build folders are not used');
    case 'hidden':
      return t('designer:template.why.hidden', 'hidden files are not kept');
    case 'link':
      return t('designer:template.why.link', 'links are not followed');
    case 'not-file':
      return t('designer:template.why.notFile', 'it is not a file');
    case 'not-picture':
      return t('designer:template.why.notPicture', 'it is not the picture its name says');
    case 'not-font':
      return t('designer:template.why.notFont', 'it is not the font its name says');
    case 'svg-runs':
      return t('designer:template.why.svgRuns', 'it holds a script or a link that runs, so it is not kept');
    case 'not-svg':
      return t('designer:template.why.notSvg', 'it is not an SVG picture');
    case 'not-text':
      return t('designer:template.why.notText', 'it does not read as text');
    default:
      return t('designer:template.why.kind', 'this kind of file is not kept');
  }
}

const iconButton = 'flex size-[22px] shrink-0 items-center justify-center rounded-md hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent';

/** What was left out of a site: a link that opens the list (the chip around it is the list's anchor). */
function LeftOut({ name, list, count }: { name: string; list: readonly { file: string; reason: LeftOutReason }[]; count: number }): ReactNode {
  return (
    <>
      <PopoverTrigger className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-bold text-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent" data-part="site-left-out">
        {t('designer:template.leftOut', '{count} left out', { count })}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" aria-label={t('designer:template.leftOutOf', 'Left out of {name}', { name })} className="w-[272px] max-w-[calc(100vw-32px)] rounded-[10px] p-1.5">
        <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">{t('designer:template.leftOutTitle', 'Left out')}</div>
        <ul className="m-0 flex list-none flex-col p-0">
          {list.map((each) => (
            <li key={each.file} className="flex items-start gap-2 px-2 py-[7px] text-[12.5px] leading-normal">
              <FileX aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
              <span className="min-w-0 break-words">{withName(t('designer:template.leftOutRow', '{file}: {why}', { file: each.file, why: leftOutWhy(each.reason) }), each.file)}</span>
            </li>
          ))}
        </ul>
        {count > list.length ? <p className="m-0 px-2 pb-1.5 text-[12px] text-fg-muted">{t('designer:template.leftOutMore', 'and {count} more', { count: count - list.length })}</p> : null}
      </PopoverContent>
    </>
  );
}

/** The question a second site asks: replace the first, or keep it. Escape keeps it. */
function ReplaceConfirm({ site }: { site: SiteControl }): ReactNode {
  const keep = useRef<HTMLButtonElement>(null);
  const confirm = site.confirm;
  useEffect(() => {
    if (confirm !== null) keep.current?.focus();
  }, [confirm]);
  if (confirm === null) return null;
  const line = t('designer:template.replaces', 'This replaces {name}. What was already built from it stays.', { name: confirm.old });
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="designer-site-replaces"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          site.keep();
        }
      }}
      className="absolute inset-x-0 bottom-[calc(100%+8px)] z-30 flex flex-col gap-3 rounded-[14px] border border-border bg-surface p-3.5 shadow-menu"
    >
      <div className="flex items-center gap-[7px] text-[11.5px] text-fg-muted">
        <FileArchive aria-hidden="true" className="size-[13px]" />
        <span>{withName(t('designer:template.dropped', '{file} dropped', { file: confirm.dropped }), confirm.dropped)}</span>
      </div>
      <p id="designer-site-replaces" className="m-0 text-pretty text-[13px] leading-normal">
        {withName(line, confirm.old)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={site.replace} className="flex-auto rounded-[10px] bg-accent px-3 py-[9px] text-[13px] font-bold text-accent-fg hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {t('designer:template.replace', 'Replace it')}
        </button>
        <button ref={keep} type="button" onClick={site.keep} className="flex-auto rounded-[10px] border border-border-strong bg-surface px-3 py-[9px] text-[13px] font-bold text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
          {t('designer:template.keep', 'Keep {name}', { name: confirm.old })}
        </button>
      </div>
    </div>
  );
}

/** The site with the message, as its chip, its upload, or the sentence it was refused with. */
export function SiteTray({ site }: { site: SiteControl }): ReactNode {
  const it = site.current;
  return (
    <>
      <ReplaceConfirm site={site} />
      {it === null ? null : it.phase === 'uploading' ? (
        <div className="flex">
          <div role="status" className="relative flex max-w-full items-center gap-[7px] overflow-hidden rounded-[10px] bg-surface-3 py-1 pe-[3px] ps-2" data-part="site-uploading">
            <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
            <span className="text-[12.5px] font-bold leading-[1.6]">{withName(t('designer:template.uploading', '{name}: uploading {percent}%', { name: it.name, percent: it.percent }), it.name)}</span>
            <button type="button" onClick={site.cancel} aria-label={t('designer:template.cancel', 'Cancel the upload')} className={`${iconButton} text-fg-muted`}>
              <X aria-hidden="true" className="size-[13px]" />
            </button>
            <span aria-hidden="true" className="absolute bottom-0 start-0 h-0.5 w-[var(--adm-site-progress)] bg-accent" style={{ '--adm-site-progress': `${String(it.percent)}%` }} />
          </div>
        </div>
      ) : (
        <Popover>
          <div className="flex">
            <PopoverAnchor asChild>
              <div className="flex max-w-full items-start gap-[7px] rounded-[10px] bg-accent-soft py-1 pe-[3px] ps-2" data-part="site-chip">
                <LayoutTemplate aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 text-accent" />
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-[12.5px] font-bold leading-[1.6]">
                  <span>
                    <span dir="auto" className="font-mono font-semibold">
                      {it.name}
                    </span>
                    <span className="font-semibold text-fg-muted">
                      <span aria-hidden="true"> · </span>
                      {it.attachment === undefined ? (
                        t('designer:template.siteWord', 'site template')
                      ) : (
                        <>
                          {t('designer:template.pages', '{count, plural, one {# page} other {# pages}}', { count: it.attachment.pages ?? 0 })}
                          <span aria-hidden="true"> · </span>
                          {t('designer:template.files', '{count, plural, one {# file} other {# files}}', { count: it.attachment.files ?? 0 })}
                        </>
                      )}
                    </span>
                  </span>
                  {it.attachment !== undefined && (it.attachment.leftOutCount ?? 0) > 0 ? <LeftOut name={it.name} list={it.attachment.leftOut ?? []} count={it.attachment.leftOutCount ?? 0} /> : null}
                </span>
                <button type="button" onClick={site.remove} aria-label={t('designer:template.remove', 'Remove {name}', { name: it.name })} className={`${iconButton} text-accent`}>
                  <X aria-hidden="true" className="size-[13px]" />
                </button>
              </div>
            </PopoverAnchor>
          </div>
        </Popover>
      )}
      {site.refused === null ? null : (
        <div role="alert" className="flex items-start gap-2 rounded-[10px] bg-danger-soft py-2 pe-1 ps-2.5 text-[12.5px] leading-normal">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 text-pretty">{site.refused}</span>
          <button type="button" onClick={site.dismiss} aria-label={t('designer:template.dismiss', 'Dismiss')} className={`${iconButton} text-fg-muted`}>
            <X aria-hidden="true" className="size-[13px]" />
          </button>
        </div>
      )}
    </>
  );
}
