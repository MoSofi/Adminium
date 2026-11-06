// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Download" on an app of the project folder (`Your Own App Page.dc.html` 3b):
 * the file another server installs, with the screens' source in it.
 *
 * The version starts at the folder's own (`manifest.json`) and can't go below
 * it; a higher one is written back to the folder before the server packs, so
 * the file's name and its content agree. Pressing Download checks, builds and
 * packs on the server; the file card and its fingerprint appear when the pack
 * is made (never a fingerprint for a file not made yet), and the browser saves
 * the file. A refused pack (the check, the build, the 32 MB limit) is said in
 * the dialog. So is a file that would carry a secret or an id of this server:
 * each file and line is listed, never the value (the server never sends it).
 */
import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Input, Modal, ModalBody, ModalFooter, ModalHeader, MonoText, Spinner } from '@adminium/ui';
import { Copy, Download, FileArchive } from 'lucide-react';
import { getFormatters } from '@adminium/i18n';

import { ApiError } from '../app/api.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { getI18nInstance, t } from '../i18n/t.js';
import { folderAppVersion, packProjectApp, packedFileUrl, type PackedAppFile } from './appFilesApi.js';

/** `a.b.c` against `x.y.z`: negative when `a` is lower. Pre-release tags count as lower than the release. */
export function compareVersions(a: string, b: string): number {
  const [coreA = '', preA] = a.split('-', 2);
  const [coreB = '', preB] = b.split('-', 2);
  const partsA = coreA.split('.').map(Number);
  const partsB = coreB.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return diff;
  }
  if (preA === undefined && preB !== undefined) return 1;
  if (preA !== undefined && preB === undefined) return -1;
  return (preA ?? '').localeCompare(preB ?? '');
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Why a typed version cannot be packed, or null. */
export function versionProblem(typed: string, current: string): string | null {
  if (!VERSION.test(typed.trim())) return t('appFiles.download.versionShape', 'A version is three numbers, like 1.2.0.');
  if (compareVersions(typed.trim(), current) < 0) return t('appFiles.download.versionBelow', 'It can’t be lower than {version}, the version the app is at.', { version: current });
  return null;
}

/** 2.4 MB, 812 KB. */
export function fileSize(bytes: number): string {
  const formatters = getFormatters(getI18nInstance()?.language ?? 'en-US');
  if (bytes >= 1024 * 1024) return `${formatters.number(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
  return `${formatters.number(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** A line of the file that would carry what must stay on this server, as the server names it. */
interface PackLeak {
  kind: 'secret' | 'id';
  file: string;
  line: number;
}

/** The lines a refused pack names, when it was refused for carrying a secret or an id of this server. */
function leaksOf(error: Error): PackLeak[] {
  if (!(error instanceof ApiError)) return [];
  const details = (error.details ?? {}) as { reason?: unknown; leaks?: unknown };
  if (details.reason !== 'PACK_LEAKS' || !Array.isArray(details.leaks)) return [];
  return (details.leaks as Partial<PackLeak>[]).flatMap((leak) =>
    (leak.kind === 'secret' || leak.kind === 'id') && typeof leak.file === 'string' && typeof leak.line === 'number' ? [{ kind: leak.kind, file: leak.file, line: leak.line }] : [],
  );
}

function leakLine(leak: PackLeak): string {
  return leak.kind === 'secret'
    ? t('appFiles.download.hitSecret', '{file}, line {line}: a secret this server keeps', { file: leak.file, line: leak.line })
    : t('appFiles.download.hitId', '{file}, line {line}: an id of this server', { file: leak.file, line: leak.line });
}

/** A refused pack, as the person reads it. */
function refusalOf(error: Error): string {
  if (!(error instanceof ApiError)) return error.message;
  const details = (error.details ?? {}) as { reason?: unknown; problems?: { message?: unknown }[]; bytes?: unknown };
  switch (details.reason) {
    case 'PACK_CHECK_FAILED': {
      const problems = (details.problems ?? []).flatMap((problem) => (typeof problem.message === 'string' ? [problem.message] : []));
      return [t('appFiles.download.checkFailed', 'The app did not pass its check, so it cannot be packed.'), ...problems.slice(0, 3)].join(' ');
    }
    case 'PACK_TOO_LARGE':
      return t('appFiles.download.tooLarge', 'The file would be {size}, and an upload takes at most 32 MB. Large pictures in its screens or sample rows are the usual cause.', {
        size: typeof details.bytes === 'number' ? fileSize(details.bytes) : '—',
      });
    case 'PACK_BUILD_FAILED':
      return t('appFiles.download.buildFailed', 'Its screens did not build, so it cannot be packed. {message}', { message: error.message });
    case 'CATALOG_SIDES':
      return t('appFiles.download.catalog', 'This app is from the catalogue. Its screens are never packed again here.');
    case 'PACK_LEAKS':
      return t('appFiles.download.leaks', 'The file would carry something that must stay on this server, so it was not made. Take it out of these files, then download again.');
    default:
      return error.message;
  }
}

/** Save a file the server holds, the way a link with `download` saves it. */
function saveFile(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

export interface DownloadAppDialogProps {
  appKey: string;
  appName: string;
  /** The folder's manifest version: the field starts here and can't go below it. Null: read it from the server first. */
  version: string | null;
  /** This server's name, under the title. */
  serverName: string;
  onClose: () => void;
  /** Told once the file is made, with what was packed (the version may have moved). */
  onPacked?: (packed: PackedAppFile) => void;
}

export function DownloadAppDialog({ appKey, appName, version: given, serverName, onClose, onPacked }: DownloadAppDialogProps) {
  useCommonWords();
  const read = useQuery({ queryKey: ['folder-app-version', appKey], queryFn: () => folderAppVersion(appKey), enabled: given === null });
  const version = given ?? read.data ?? null;
  const [typedRaw, setTyped] = useState<string | null>(given);
  const typed = typedRaw ?? version ?? '';
  const [copied, setCopied] = useState(false);
  const fieldId = useId();
  const errorId = useId();
  const problem = version === null ? (read.isPending ? null : t('appFiles.download.notInstalled', 'This app is not installed from its folder yet, so it has no version to start from.')) : versionProblem(typed, version);
  const pack = useMutation({
    mutationFn: () => packProjectApp(appKey, typed.trim()),
    onSuccess: (packed) => {
      onPacked?.(packed);
      saveFile(packedFileUrl(packed.key, packed.version), packed.fileName);
    },
  });
  const packed = pack.data ?? null;
  const fileName = packed?.fileName ?? `${appKey}-${typed.trim()}.tgz`;

  return (
    <Modal open onOpenChange={(next) => !next && onClose()}>
      <ModalHeader
        icon={<Download />}
        title={t('appFiles.download.title', 'Download {app}', { app: appName })}
        subtitle={
          <>
            <MonoText>{appKey}</MonoText> · {serverName}
          </>
        }
        closeLabel={t('appFiles.download.closeLabel', 'Close')}
      />
      <ModalBody className="flex flex-col gap-3.5 leading-[normal]">
        <p className="text-[13px] leading-[1.5] text-fg-muted">
          {t('appFiles.download.body', 'The file holds the screens and their source, so another server can keep editing them. Build settings and scripts are left out.')}
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-[12.5px] font-bold">
            {t('appFiles.download.version', 'Version')}
          </label>
          <Input
            id={fieldId}
            className="w-40 max-w-full font-mono text-[12.5px]"
            value={typed}
            spellCheck={false}
            autoComplete="off"
            disabled={pack.isPending || packed !== null}
            aria-invalid={problem !== null || undefined}
            aria-describedby={problem === null ? undefined : errorId}
            onChange={(event) => setTyped(event.currentTarget.value)}
          />
          {problem === null ? null : (
            <p id={errorId} className="text-xs text-danger">
              {problem}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface-2 p-3.5" aria-live="polite">
          <div className="flex items-center gap-[11px]">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-fg-muted">
              {pack.isPending ? <Spinner size="sm" /> : <FileArchive className="size-[18px]" />}
            </span>
            <div className="min-w-0 flex-1">
              <MonoText className="block text-[12.5px] font-bold [overflow-wrap:anywhere]">{fileName}</MonoText>
              <MonoText className="block text-[11.5px] text-fg-subtle">
                {packed !== null
                  ? fileSize(packed.bytes)
                  : pack.isPending
                    ? t('appFiles.download.packing', 'Checking, building and packing…')
                    : t('appFiles.download.notYet', 'Made when you press Download')}
              </MonoText>
            </div>
          </div>
          {packed === null ? null : (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">{t('appFiles.download.fingerprint', 'Fingerprint')}</div>
              <div className="flex items-center gap-2">
                <code dir="ltr" className="min-w-0 flex-1 font-mono text-[11.5px] leading-[1.45] text-fg-muted [overflow-wrap:anywhere]">
                  {packed.integrity}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(packed.integrity).then(() => setCopied(true));
                  }}
                >
                  <Copy aria-hidden className="size-[15px]" />
                  {copied ? t('appFiles.download.copied', 'Copied') : t('appFiles.download.copy', 'Copy')}
                </Button>
              </div>
              <div className="text-[11.5px] text-fg-subtle">{t('appFiles.download.fingerprintHint', 'Whoever installs it can check the file against this.')}</div>
            </div>
          )}
        </div>
        {packed === null ? null : (
          <p role="status" className="text-xs text-fg-muted">
            {t('appFiles.download.downloading', 'Downloading {file}', { file: packed.fileName })}
          </p>
        )}
        {pack.error === null ? null : (
          <Alert
            tone="danger"
            role="alert"
            title={refusalOf(pack.error)}
            body={
              leaksOf(pack.error).length === 0 ? undefined : (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {leaksOf(pack.error).map((leak) => (
                    <li key={`${leak.kind}|${leak.file}|${String(leak.line)}`} dir="ltr" className="font-mono text-[11.5px] [overflow-wrap:anywhere]">
                      {leakLine(leak)}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {packed === null ? t('appFiles.download.cancel', 'Cancel') : t('appFiles.download.close', 'Done')}
        </Button>
        {packed === null ? (
          <Button disabled={version === null || problem !== null || pack.isPending} onClick={() => pack.mutate()}>
            <Download aria-hidden className="size-[15px]" />
            {t('appFiles.download.action', 'Download')}
          </Button>
        ) : (
          <Button onClick={() => saveFile(packedFileUrl(packed.key, packed.version), packed.fileName)}>
            <Download aria-hidden className="size-[15px]" />
            {t('appFiles.download.again', 'Download again')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
