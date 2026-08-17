// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Duplicate page" — the copy needs its own identity, and only two fields of
 * it. Everything else (template, widgets, columns, source binding, and the
 * source page's role audience) is carried over by the server.
 */

import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  FormField,
  Input,
  InputGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@adminium/ui';

import { t } from '../../i18n/t.js';
import {
  PAGE_URL_PREFIX,
  duplicatePage,
  slugify,
  slugifyInput,
  type PageSummaryDto,
} from './pagesApi.js';

interface DuplicatePageModalProps {
  page: PageSummaryDto;
  onClose: () => void;
  onDuplicated: () => void | Promise<void>;
}

export function DuplicatePageModal({ page, onClose, onDuplicated }: DuplicatePageModalProps) {
  const [title, setTitle] = useState(`${page.title} copy`);
  const [slug, setSlug] = useState(slugify(`${page.slug}-copy`));

  const finalSlug = slugify(slug);

  const duplicate = useMutation({
    mutationFn: () => duplicatePage(page.id, { slug: finalSlug, title: title.trim() }),
    onSuccess: onDuplicated,
  });

  const canSubmit = title.trim().length > 0 && finalSlug.length > 0;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    duplicate.mutate();
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
    >
      <ModalHeader
        title={t('studioPages.duplicate.title', 'Duplicate page')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <form id="studio-page-duplicate" className="flex flex-col gap-4" onSubmit={submit}>
          <FormField label={t('studioPages.field.title', 'Title')}>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </FormField>
          <FormField label={t('studioPages.field.slug', 'Page address')}>
            <InputGroup
              prefix={PAGE_URL_PREFIX}
              mono
              value={slug}
              onChange={(event) => setSlug(slugifyInput(event.target.value))}
              data-testid="studio-pages-duplicate-slug"
            />
          </FormField>
          {duplicate.isError ? (
            <Alert
              tone="danger"
              title={t('studioPages.duplicate.failed', 'The page could not be duplicated')}
              body={duplicate.error instanceof Error ? duplicate.error.message : ''}
            />
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          type="submit"
          form="studio-page-duplicate"
          disabled={!canSubmit}
          loading={duplicate.isPending}
          data-testid="studio-pages-duplicate-submit"
        >
          {t('studioPages.duplicate.submit', 'Duplicate')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
