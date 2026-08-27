// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rename a connection.
 *
 * ─── Why this screen had to exist ────────────────────────────────────────────
 *
 * A connection's name is the label an operator reads everywhere: the hub card,
 * the sidebar group over its generated pages, the surface pickers, the domain
 * editor. `PATCH /connections/:id` has accepted `name` since the route was
 * written, and nothing in the product ever sent it — so a connection kept
 * whatever it was called at creation. The first-boot seed names one after the
 * DATABASE (`c_client_portal`), which is how an instance ends up with one
 * connection called "Clinic (Rowan Health)" and another called `c_client_portal`
 * in the same rail.
 *
 * ─── Why it invalidates `bootstrap` as well ──────────────────────────────────
 *
 * The hub reads names from the connections query; the SIDEBAR reads them from
 * `bootstrap` (`connectionNames`, which annotates every generated page with its
 * owning connection). Refreshing only the first renames the card and leaves the
 * rail saying the old name until the next full load — which reads as the rename
 * having silently failed. Both, or neither.
 */

import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { studioApi, type ConnectionDto } from '../api.js';

/** `connectionPatchBody` in the server's own schema — mirrored, not guessed. */
const MAX_NAME = 80;

export interface RenameConnectionModalProps {
  connection: ConnectionDto;
  onClose: () => void;
  /** Invalidates the connections AND bootstrap queries; awaited before closing. */
  onSaved: () => void | Promise<void>;
}

export function RenameConnectionModal({ connection, onClose, onSaved }: RenameConnectionModalProps) {
  const [name, setName] = useState(connection.name);

  const trimmed = name.trim();
  /*
   * Trimmed for the comparison as well as the write: " Neon " is not a rename,
   * and offering Save for it would spend a round trip to store a string the
   * server would hand straight back.
   */
  const valid = trimmed.length > 0 && trimmed.length <= MAX_NAME;
  const dirty = trimmed !== connection.name;

  const save = useMutation({
    mutationFn: () => studioApi.patchConnection(connection.id, { name: trimmed }),
    onSuccess: onSaved,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!valid || !dirty) return;
    save.mutate();
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
        title={t('studio.hub.rename.title', 'Rename connection')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <form id="studio-rename-connection" className="flex flex-col gap-4" onSubmit={submit}>
          <FormField
            label={t('studio.hub.rename.label', 'Name')}
            helper={t(
              'studio.hub.rename.helper',
              'What this database is called throughout Adminium — the card, the sidebar group over its pages, and every picker that offers it. The database itself is not renamed.',
            )}
          >
            <Input
              value={name}
              maxLength={MAX_NAME}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              data-testid="rename-input"
            />
          </FormField>

          {save.isError ? (
            <Alert
              tone="danger"
              title={t('studio.hub.rename.failed', 'The connection could not be renamed')}
              body={save.error instanceof Error ? save.error.message : ''}
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
          form="studio-rename-connection"
          disabled={!valid || !dirty}
          loading={save.isPending}
          data-testid="rename-save"
        >
          {t('studio.hub.rename.save', 'Rename')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
