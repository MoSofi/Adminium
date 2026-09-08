// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Import template (D14, Appendix A §M1): a JSON bundle the export produced,
 * shown as a preview — *N templates and M campaigns · K already exist* — with
 * *Skip existing / Replace existing* and one *Import*. The server does the
 * work (files re-created, senders checked, the import audited); this modal
 * only reads the file, counts, and reports the reply as a toast.
 *
 * The comp leaves the import undrawn (§0 #15): this is the confirm-modal
 * anatomy with the comp's segment control in the body.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, SegmentedControl } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { emailApi, type EmailImportReply } from '../api.js';
import { emailDocumentsQuery } from '../queries.js';

export interface ImportModalProps {
  onClose: () => void;
  onImported: (reply: EmailImportReply) => void;
}

interface BundleDocument {
  kind: string;
  key: string;
  locale: string;
}

interface ParsedBundle {
  bundle: unknown;
  documents: BundleDocument[];
}

/** The bundle's outer shape, checked before a byte leaves the browser. */
export function parseBundle(text: string): ParsedBundle | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const stamp = record['adminium'];
  if (typeof stamp !== 'object' || stamp === null) return null;
  const meta = stamp as Record<string, unknown>;
  if (meta['kind'] !== 'email-templates' || meta['version'] !== 1) return null;
  const documents = record['documents'];
  if (!Array.isArray(documents)) return null;
  const rows: BundleDocument[] = [];
  for (const entry of documents) {
    if (typeof entry !== 'object' || entry === null) return null;
    const doc = entry as Record<string, unknown>;
    if (typeof doc['kind'] !== 'string' || typeof doc['key'] !== 'string' || typeof doc['locale'] !== 'string') return null;
    rows.push({ kind: doc['kind'], key: doc['key'], locale: doc['locale'] });
  }
  return { bundle: value, documents: rows };
}

export function ImportModal({ onClose, onImported }: ImportModalProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [parsed, setParsed] = useState<ParsedBundle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [mode, setMode] = useState<'skip' | 'replace'>('skip');
  // Every live document, both kinds: the "already exist" count is a (key, locale) match.
  const existing = useQuery(emailDocumentsQuery({}));

  const importBundle = useMutation({
    mutationFn: () => emailApi.importBundle(parsed?.bundle, mode),
    onSuccess: (reply) => onImported(reply),
  });

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setFileName(file.name);
    const text = await file.text();
    const next = parseBundle(text);
    setParsed(next);
    setInvalid(next === null);
  };

  const existingKeys = new Set((existing.data?.items ?? []).map((doc) => `${doc.key}:${doc.locale}`));
  const templates = parsed?.documents.filter((doc) => doc.kind === 'template').length ?? 0;
  const campaigns = parsed?.documents.filter((doc) => doc.kind === 'campaign').length ?? 0;
  const duplicates = parsed?.documents.filter((doc) => existingKeys.has(`${doc.key}:${doc.locale}`)).length ?? 0;
  const busy = importBundle.isPending;

  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ModalHeader
        icon={<Upload />}
        title={t('email:import.title', 'Import template')}
        subtitle={t('email:import.subtitle', 'A bundle exported from Adminium.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4">
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          data-testid="email-import-file"
          aria-label={t('email:import.choose', 'Choose a bundle')}
          className="sr-only"
          onChange={(event) => {
            void onFile(event);
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="flex flex-col items-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-border-strong bg-surface-2 px-4 py-6 text-center transition-colors hover:border-accent"
        >
          <Upload className="size-5 text-fg-muted" aria-hidden="true" />
          <span className="text-[13px] font-bold text-fg">
            {fileName ?? t('email:import.choose', 'Choose a bundle')}
          </span>
          <span className="text-[11px] text-fg-subtle">{t('email:import.hint', 'adminium-email-templates-<date>.json')}</span>
        </button>
        {invalid ? (
          <p role="alert" data-testid="email-import-invalid" className="text-body-sm text-danger">
            {t('email:import.invalid', 'That file is not an Adminium email bundle.')}
          </p>
        ) : null}
        {parsed === null ? null : (
          <>
            <p data-testid="email-import-summary" className="text-body-sm text-fg-muted">
              {t('email:import.summary', '{templates, plural, one {# template} other {# templates}} and {campaigns, plural, one {# campaign} other {# campaigns}} · {duplicates} already exist', {
                templates,
                campaigns,
                duplicates,
              })}
            </p>
            <SegmentedControl
              aria-label={t('email:import.modeLabel', 'Existing documents')}
              data-testid="email-import-mode"
              value={mode}
              onValueChange={(value) => setMode(value === 'replace' ? 'replace' : 'skip')}
              options={[
                { value: 'skip', label: t('email:import.skip', 'Skip existing') },
                { value: 'replace', label: t('email:import.replace', 'Replace existing') },
              ]}
            />
          </>
        )}
        {importBundle.isError ? (
          <p role="alert" className="text-body-sm text-danger">
            {importBundle.error instanceof Error ? importBundle.error.message : t('email:import.failed', 'The import failed.')}
          </p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          onClick={() => importBundle.mutate()}
          disabled={parsed === null || parsed.documents.length === 0}
          loading={busy}
          data-testid="email-import-confirm"
        >
          {t('email:import.confirm', 'Import')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
