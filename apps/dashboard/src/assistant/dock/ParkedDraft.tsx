// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A draft that is not usable where the person is now (Milo Panel, section 10).
 *
 * A draft belongs to the page, and for an editor to the document, it was made
 * for: saved or put on screen anywhere else it would land in the wrong place.
 * So away from its page the card keeps its title, says where it was made, and
 * offers the way back. The server refuses the action as well; this is why the
 * person is not offered it.
 */
import { ArrowRight, FileText, FileX, MapPin } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { AssistantContext } from '../api.js';
import { contextCopy } from '../contexts.js';
import type { ThreadTurn } from '../thread.js';

/** Where a context's drafts are used: its manager, or the open document's editor. Null: a page with no fixed address. */
export interface DraftHome {
  to: string;
  params?: Record<string, string>;
}

/** The address of a draft's home, for the link's own `href`: opened in a new tab it still goes there. */
export function draftHref(home: DraftHome): string {
  return Object.entries(home.params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, encodeURIComponent(value)), home.to);
}

export function draftHome(context: AssistantContext, documentId: string | null): DraftHome | null {
  switch (context) {
    case 'email':
      return documentId === null ? { to: '/email-templates' } : { to: '/email-templates/$id', params: { id: documentId } };
    case 'report':
      return documentId === null ? { to: '/report-builder' } : { to: '/report-builder/$id', params: { id: documentId } };
    case 'automation':
      return { to: '/automations' };
    default:
      // An invoice builder is a page of the workspace, under whatever slug it was given.
      return null;
  }
}

export interface ParkedDraftProps {
  title: string;
  /** The turn that made it: its context and document say where it belongs. */
  madeOn: Pick<ThreadTurn, 'context' | 'on'>;
  name: string;
  /** Go there, inside the app. Absent (a story): the link is a plain link. */
  onOpen?: ((home: DraftHome) => void) | undefined;
}

export function ParkedDraft({ title, madeOn, name, onOpen }: ParkedDraftProps) {
  const page = madeOn.on.title ?? contextCopy(madeOn.context, {}, name).page;
  // Its document is gone: there is nowhere left to use it, and nothing to offer.
  const gone = madeOn.on.gone;
  const home = gone ? null : draftHome(madeOn.context, madeOn.on.documentId);
  return (
    <div data-testid="assistant-parked-draft" className="min-w-0 flex-1 overflow-hidden rounded-[16px] border border-border bg-surface shadow-menu">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
        <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-extrabold text-fg">{title}</span>
      </div>
      <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3">
        <div className="flex items-start gap-[7px] text-[12px] font-medium leading-[1.5] text-fg-muted">
          {gone ? <FileX className="mt-[3px] size-3 shrink-0" aria-hidden="true" /> : <MapPin className="mt-[3px] size-3 shrink-0" aria-hidden="true" />}
          <span>{gone ? t('assistant:parked.deleted', 'This draft’s document was deleted.') : t('assistant:parked.madeOn', 'Made on {page}.', { page })}</span>
        </div>
        {home === null ? null : (
          <a
            href={draftHref(home)}
            onClick={(event) => {
              // A plain click stays in the app; a modified one (new tab) is the browser's.
              if (onOpen === undefined || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onOpen(home);
            }}
            className="nb-press inline-flex items-center gap-[7px] self-start whitespace-nowrap rounded-[10px] border border-border-strong bg-surface px-[13px] py-2 text-[12.5px] font-bold leading-[1.2] text-fg hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t('assistant:parked.open', 'Open {page} to use this draft', { page })}
            <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}
