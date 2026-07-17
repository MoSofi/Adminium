/**
 * Step 1 — "Welcome & data location" (11-electron.md §6).
 *
 * Shows `<userData>/data` with a Change… button, and §6's blocking cloud-sync
 * warning when the picked folder is inside one.
 *
 * THE WARNING IS NOT RENDERED FROM A LOCAL CHECK. `detectCloudSyncFolder` lives
 * in the main process (11-T03) and the SPA cannot reach it, so this component
 * asks `setDataDir` to commit and renders the refusal it gets back. That is the
 * correct direction of authority — the gate is on the side that owns the file —
 * and it is why "Continue" is the moment the check happens rather than the pick:
 * the answer and the act are the same call.
 */
import { AlertTriangle, FolderOpen, HardDrive } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, Card, CardBody, IconTile, MonoText } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { CloudSyncBlock } from '../desktopSetupState.js';

export interface DataLocationStepProps {
  /** The directory in force, from `getRuntimeInfo()`. `null` while it loads. */
  currentDataDir: string | null;
  /** Picked but not committed; `null` ⇒ keeping {@link currentDataDir}. */
  pendingDataDir: string | null;
  /** §6's blocking warning, as the main process refused it. */
  cloudSync: CloudSyncBlock | null;
  /** The main process could not use the folder (not writable, …). */
  unusableReason: string | null;
  busy: boolean;
  onChoose: () => void;
  onRevert: () => void;
  /** Re-commit with the acknowledgement §6 requires. */
  onAcknowledgeCloudSync: () => void;
}

export function DataLocationStep(props: DataLocationStepProps): ReactNode {
  const effective = props.pendingDataDir ?? props.currentDataDir;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-section text-fg">{t('desktop.setup.dataDir.heading', 'Where should Adminium keep your data?')}</h2>
        <p className="text-body-sm text-fg-muted">
          {t(
            'desktop.setup.dataDir.description',
            'Your databases, settings and backups all live in this folder. Everything stays on this computer — nothing is uploaded anywhere.',
          )}
        </p>
      </div>

      <Card>
        <CardBody className="flex items-start gap-3">
          <IconTile tone="accent" size="md" icon={<HardDrive />} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-body-sm font-semibold text-fg">
              {t('desktop.setup.dataDir.label', 'Data folder')}
            </span>
            {effective === null ? (
              <span className="text-body-sm text-fg-muted">
                {t('desktop.setup.dataDir.loading', 'Reading the current location…')}
              </span>
            ) : (
              <MonoText className="break-all text-body-sm text-fg-muted">{effective}</MonoText>
            )}
            {props.pendingDataDir === null ? null : (
              <p className="text-body-sm text-fg-muted">
                {t(
                  'desktop.setup.dataDir.pending',
                  'Adminium restarts when you continue, so it can move to this folder.',
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {props.pendingDataDir === null ? null : (
              <Button variant="ghost" onClick={props.onRevert} disabled={props.busy}>
                {t('desktop.setup.dataDir.revert', 'Undo')}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={props.onChoose}
              disabled={props.busy}
              iconLeft={<FolderOpen aria-hidden />}
            >
              {t('desktop.setup.dataDir.change', 'Change…')}
            </Button>
          </div>
        </CardBody>
      </Card>

      {props.cloudSync === null ? null : (
        <Alert
          tone="danger"
          role="alert"
          title={t('desktop.setup.dataDir.cloudSyncTitle', 'This folder is synced to the cloud')}
        >
          <div className="flex flex-col gap-3">
            {/* The main process names the KEY (`config.ts`'s
                `CLOUD_SYNC_WARNING_I18N_KEY`) and the wizard owns its 8
                translations — which is why the key arrives as data and the
                fallback below is still written out in full: `t()` needs one, and
                a bundle that lost this string must not degrade to a blank
                warning. `matchedSegment` is the folder the detector actually
                recognised; showing it turns "we think this is Dropbox" into a
                claim the user can check. */}
            <p className="text-body-sm">
              {t(
                props.cloudSync.messageKey,
                'Adminium stores its data in SQLite files. {provider} syncs files in “{folder}” by copying them in the background, which can corrupt a database that is open — losing data with no warning. Pick a folder outside {provider}.',
                {
                  provider: props.cloudSync.providerLabel,
                  folder: props.cloudSync.matchedSegment,
                },
              )}
            </p>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={props.onChoose} disabled={props.busy}>
                {t('desktop.setup.dataDir.chooseAnother', 'Choose another folder')}
              </Button>
              {/* §6: "require explicit confirmation" — a second, deliberate act,
                  never a checkbox that Continue could carry along with it. */}
              <Button
                variant="destructiveSoft"
                onClick={props.onAcknowledgeCloudSync}
                loading={props.busy}
                iconLeft={<AlertTriangle aria-hidden />}
              >
                {t('desktop.setup.dataDir.useAnyway', 'Use it anyway — I accept the risk')}
              </Button>
            </div>
          </div>
        </Alert>
      )}

      {props.unusableReason === null ? null : (
        <Alert
          tone="danger"
          role="alert"
          title={t('desktop.setup.dataDir.unusableTitle', 'Adminium cannot use that folder')}
          body={props.unusableReason}
        />
      )}
    </div>
  );
}
