// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A site template with a message: a zip, or a folder the page packs into one.
 *
 * Or one of the project's own site templates, taken by its name: the server reads the folder. Where a
 * session exists (the build page) it goes in the moment it is chosen, and the chip shows how far;
 * Send waits for it. On Home there is no session yet: the page holds the zip and sends it right
 * after the session is made, as the first thing the message carries. A session holds one site: a
 * second asks first ("This replaces …"), whether the first is still in the tray or went with an
 * earlier message (the server says so, with that site's name). Refusals are the server's sentence,
 * naming the file.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { designerApi, type DesignerAttachment } from '../api.js';
import { packZip, PackRefusal, readFolder, SITE_MAX_ENTRIES, SITE_MAX_ZIP_BYTES } from './packSite.js';

interface Pending {
  key: string;
  /** What the site is called: the zip's name without `.zip`, or the folder's. */
  name: string;
  /** What the server is told it was called. */
  filename: string;
  /** A zip to send, or a template of the project the server reads by its name. */
  source: { kind: 'zip'; zip: Blob } | { kind: 'project' };
}

export interface SiteTrayItem {
  key: string;
  name: string;
  /** Held: waiting for a session (Home). Uploading: on its way, `percent` of it. Reading: the server reads the project's folder. Ready: in the session. */
  phase: 'held' | 'uploading' | 'reading' | 'ready';
  percent: number;
  attachment?: DesignerAttachment;
  sessionId?: string;
  pending: Pending;
}

export interface SiteControl {
  current: SiteTrayItem | null;
  /** The sentence a site was refused with; null when none was. */
  refused: string | null;
  /** A second site, waiting for the person to say whether it replaces the first. */
  confirm: { dropped: string; old: string } | null;
  uploading: boolean;
  addZip(file: File): void;
  addFolder(dir: FileSystemDirectoryEntry): void;
  /** A folder picked with the chooser: its files, by their paths inside it. */
  addFiles(name: string, files: readonly { path: string; file: File }[]): void;
  /** One of the project's own site templates, by the name the server listed. */
  addProject(name: string): void;
  replace(): void;
  keep(): void;
  dismiss(): void;
  cancel(): void;
  remove(): void;
  /** At send: the site's id in that session, sending it first when it is still held. Null with no site. */
  send(sessionId: string): Promise<string | null>;
  /** The message went: the site is no longer waiting with it. */
  sent(): void;
}

/** A box that takes no site. */
export const NO_SITE: SiteControl = {
  current: null,
  refused: null,
  confirm: null,
  uploading: false,
  addZip: () => undefined,
  addFolder: () => undefined,
  addFiles: () => undefined,
  addProject: () => undefined,
  replace: () => undefined,
  keep: () => undefined,
  dismiss: () => undefined,
  cancel: () => undefined,
  remove: () => undefined,
  send: async () => null,
  sent: () => undefined,
};

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';
const detailsOf = (error: unknown): { reason?: string; site?: { id: string; label: string } } =>
  error instanceof ApiError && typeof error.details === 'object' && error.details !== null ? (error.details as { reason?: string; site?: { id: string; label: string } }) : {};

export function useSite(opts: { sessionId?: string | undefined; notify?: ((title: string) => void) | undefined } = {}): SiteControl {
  const { sessionId, notify } = opts;
  const [current, setCurrent] = useState<SiteTrayItem | null>(null);
  const held = useRef<SiteTrayItem | null>(null);
  const put = useCallback((next: SiteTrayItem | null) => {
    held.current = next;
    setCurrent(next);
  }, []);
  const [refused, setRefused] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ dropped: string; old: string; next: Pending; replaceId: string | undefined } | null>(null);
  const inflight = useRef<{ key: string; promise: Promise<DesignerAttachment>; abort: AbortController } | null>(null);
  const seq = useRef(0);

  const start = useCallback(
    (pending: Pending, target: string, replaceId: string | undefined, confirmed: boolean): Promise<DesignerAttachment> => {
      const abort = new AbortController();
      const item: SiteTrayItem = { key: pending.key, name: pending.name, phase: pending.source.kind === 'zip' ? 'uploading' : 'reading', percent: 0, pending };
      put(item);
      const sending: Promise<DesignerAttachment> =
        pending.source.kind === 'project'
          ? designerApi.siteFromProject(target, pending.name, replaceId)
          : designerApi.uploadSite(target, pending.source.zip, pending.filename, {
              ...(replaceId === undefined ? {} : { replace: replaceId }),
              signal: abort.signal,
              onProgress: (fraction) => {
                const now = held.current;
                if (now?.key === pending.key && now.phase === 'uploading') put({ ...now, percent: Math.min(99, Math.round(fraction * 100)) });
              },
            });
      const promise: Promise<DesignerAttachment> = sending
        .then((attachment) => {
          if (held.current?.key === pending.key) put({ ...item, phase: 'ready', percent: 100, attachment, sessionId: target });
          return attachment;
        })
        .catch((error: unknown): Promise<DesignerAttachment> => {
          if (inflight.current?.key === pending.key) inflight.current = null;
          if (isAbort(error)) throw error;
          const details = detailsOf(error);
          if (details.reason === 'SITE_REPLACES' && details.site !== undefined) {
            // The person already said to replace it: the server only named the site it meant.
            if (confirmed) return start(pending, target, details.site.id, true);
            if (held.current?.key === pending.key) put(null);
            setConfirm({ dropped: pending.filename, old: details.site.label, next: pending, replaceId: details.site.id });
            throw error;
          }
          if (held.current?.key === pending.key) put(null);
          setRefused(error instanceof Error ? error.message : String(error));
          throw error;
        });
      inflight.current = { key: pending.key, promise, abort };
      return promise;
    },
    [put],
  );

  const place = useCallback(
    (pending: Pending, replaceId: string | undefined, confirmed: boolean) => {
      if (sessionId === undefined) {
        put({ key: pending.key, name: pending.name, phase: 'held', percent: 0, pending });
        return;
      }
      start(pending, sessionId, replaceId, confirmed).catch(() => undefined);
    },
    [put, sessionId, start],
  );

  const begin = useCallback(
    (pending: Pending) => {
      setRefused(null);
      const old = held.current;
      if (old !== null) {
        setConfirm({ dropped: pending.filename, old: old.name, next: pending, replaceId: old.attachment?.id });
        return;
      }
      place(pending, undefined, false);
    },
    [place],
  );

  const addZip = useCallback(
    (file: File) => {
      const name = file.name.replace(/\.zip$/i, '') || file.name;
      if (file.size > SITE_MAX_ZIP_BYTES) {
        setRefused(t('designer:template.tooLarge', '{name} is over 25 MB.', { name: file.name }));
        return;
      }
      seq.current += 1;
      begin({ key: `s${String(seq.current)}`, name, filename: file.name, source: { kind: 'zip', zip: file } });
    },
    [begin],
  );

  const addFiles = useCallback(
    (name: string, files: readonly { path: string; file: File }[]) => {
      setRefused(null);
      if (files.length > SITE_MAX_ENTRIES) {
        setRefused(t('designer:template.tooMany', '{name} has more than 1,000 files and folders.', { name }));
        return;
      }
      if (files.reduce((sum, each) => sum + each.file.size, 0) > SITE_MAX_ZIP_BYTES) {
        setRefused(t('designer:template.tooLarge', '{name} is over 25 MB.', { name }));
        return;
      }
      if (files.length === 0) {
        setRefused(t('designer:template.folderEmpty', '{name} has no files in it.', { name }));
        return;
      }
      void packZip(files).then((zip) => {
        seq.current += 1;
        begin({ key: `s${String(seq.current)}`, name, filename: name, source: { kind: 'zip', zip } });
      });
    },
    [begin],
  );

  const addProject = useCallback(
    (name: string) => {
      seq.current += 1;
      begin({ key: `s${String(seq.current)}`, name, filename: name, source: { kind: 'project' } });
    },
    [begin],
  );

  const addFolder = useCallback(
    (dir: FileSystemDirectoryEntry) => {
      setRefused(null);
      readFolder(dir)
        .then(async (files) => {
          if (files.length === 0) {
            setRefused(t('designer:template.folderEmpty', '{name} has no files in it.', { name: dir.name }));
            return;
          }
          seq.current += 1;
          begin({ key: `s${String(seq.current)}`, name: dir.name, filename: dir.name, source: { kind: 'zip', zip: await packZip(files) } });
        })
        .catch((error: unknown) => {
          const reason = error instanceof PackRefusal ? error.reason : 'unreadable';
          setRefused(
            reason === 'too-many'
              ? t('designer:template.tooMany', '{name} has more than 1,000 files and folders.', { name: dir.name })
              : reason === 'too-large'
                ? t('designer:template.tooLarge', '{name} is over 25 MB.', { name: dir.name })
                : t('designer:template.unreadable', '{name} could not be read. Drop the folder again, or zip it first.', { name: dir.name }),
          );
        });
    },
    [begin],
  );

  const replace = useCallback(() => {
    const chosen = confirm;
    setConfirm(null);
    if (chosen === null) return;
    // A first site still on its way is stopped: the server is told to replace whichever site it holds.
    if (held.current?.phase === 'uploading' || held.current?.phase === 'reading') inflight.current?.abort.abort();
    put(null);
    place(chosen.next, chosen.replaceId, true);
    notify?.(t('designer:template.inTray', '{name} is in the tray.', { name: chosen.next.name }));
  }, [confirm, notify, place, put]);

  const remove = useCallback(() => {
    const it = held.current;
    if (it === null) return;
    put(null);
    if (it.phase === 'uploading' || it.phase === 'reading') inflight.current?.abort.abort();
    if (it.phase === 'ready' && it.attachment !== undefined && it.sessionId !== undefined) designerApi.removeAttachment(it.sessionId, it.attachment.id).catch(() => undefined);
    notify?.(t('designer:template.removed', '{name} is off this message.', { name: it.name }));
  }, [notify, put]);

  const cancel = useCallback(() => {
    inflight.current?.abort.abort();
    inflight.current = null;
    put(null);
    notify?.(t('designer:template.cancelled', 'Upload cancelled.'));
  }, [notify, put]);

  const send = useCallback(
    async (target: string): Promise<string | null> => {
      const it = held.current;
      if (it === null) return null;
      if (it.phase === 'ready' && it.attachment !== undefined && it.sessionId === target) return it.attachment.id;
      if ((it.phase === 'uploading' || it.phase === 'reading') && inflight.current?.key === it.key) return (await inflight.current.promise).id;
      return (await start(it.pending, target, undefined, false)).id;
    },
    [start],
  );

  const sent = useCallback(() => {
    if (held.current?.phase === 'ready') put(null);
  }, [put]);

  return useMemo(
    () => ({
      current,
      refused,
      confirm: confirm === null ? null : { dropped: confirm.dropped, old: confirm.old },
      uploading: current?.phase === 'uploading' || current?.phase === 'reading',
      addZip,
      addFolder,
      addFiles,
      addProject,
      replace,
      keep: () => setConfirm(null),
      dismiss: () => setRefused(null),
      cancel,
      remove,
      send,
      sent,
    }),
    [current, refused, confirm, addZip, addFolder, addFiles, addProject, replace, cancel, remove, send, sent],
  );
}
