// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app: the steps drawn from notes rather than from the comp. The
 * Database step lists every database once with its workspace chips (the comp
 * predates workspaces); Check shows a secret that blocks saving, a question,
 * the personal views at "0 of N", and an answered item.
 *
 * The wizard's choices mode, as Save workspace's "More choices" opens it in a
 * modal over the dialog: the database is fixed, so there are four steps, no
 * Back out of What to include, and Check ends in "Use these choices" rather
 * than Save. Nothing asks a server: the steps take their data as props.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Modal, ModalBody, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { makeBootstrap } from '../../test/fixtures.js';
import type { ConnectionDto } from '../api.js';
import { SaveAppCheck } from './SaveAppCheck.js';
import { SaveAppWizard, SaveDatabaseChoice, type WizardStep } from './SaveAppWizard.js';
import type { SaveFlowShared } from './saveAppShared.js';
import type { CheckItem, SaveInventory, SavePlan } from './saveAppApi.js';
import { draftFromInventory, type SaveDraft } from './saveAppDraft.js';
import type { SaveDatabase } from './saveAppDatabases.js';

const connection = (id: string, name: string, engine: string, tableCount: number) => ({ id, name, engine, tableCount }) as unknown as ConnectionDto;

const WITH_CHIPS: SaveDatabase[] = [
  { connection: connection('con_f', 'fernhill', 'postgres', 30), workspaces: ['Fernhill Coffee'], other: false },
  { connection: connection('con_s', 'shared_stock', 'postgres', 8), workspaces: ['Fernhill Coffee', 'Kiln Street Pottery'], other: false },
  { connection: connection('con_k', 'kiln', 'mysql', 12), workspaces: ['Kiln Street Pottery'], other: false },
  { connection: connection('con_a', 'fernhill_archive', 'postgres', 12), workspaces: [], other: true },
];

function Database({ databases }: { databases: SaveDatabase[] }): ReactNode {
  const [chosen, setChosen] = useState<string>('con_f');
  return (
    <div className="max-w-[880px] p-6 leading-[normal]">
      <SaveDatabaseChoice databases={databases} connectionId={chosen} onConnection={setChosen} />
    </div>
  );
}

const INVENTORY: SaveInventory = {
  connectionId: 'con_f',
  tables: [{ id: 'public.activity_log', name: 'activity_log', columns: 8, rows: 400, rowsExact: true, links: [], personal: [], secretLike: [], rowsAllowed: true, personalAllowed: true }],
  pages: [{ id: 'page_roasts', title: 'Needs packing', tableId: 'public.activity_log', generated: true }],
  views: [
    { id: 'view_1', name: 'Today’s roasts', pageId: 'page_roasts', ownerId: 'usr_rosa', ownerName: 'Rosa Okafor' },
    { id: 'view_2', name: 'Low stock beans', pageId: 'page_roasts', ownerId: 'usr_june', ownerName: 'June Park' },
  ],
  roles: [],
  automations: [],
  emailTemplates: [],
  documents: [],
  reports: [],
  invoiceLayouts: [],
  scheduledReports: [],
  publicEndpoints: [],
  payments: false,
  instance: false,
};

const SECRET: CheckItem = {
  group: 'choice',
  code: 'SECRET_FOUND',
  kind: 'automation',
  item: 'Post wholesale orders to Slack',
  field: 'message body',
  message: '',
  answer: { choices: ['clear', 'leave-out'], target: 't1', targets: { 'leave-out': 't1o' } },
};
const NO_TYPE: CheckItem = {
  group: 'choice',
  code: 'TYPE_NO_FORM',
  kind: 'column',
  item: 'activity_log',
  field: 'ip_address',
  message: '',
  answer: { choices: ['carry-as-text', 'leave-out'], target: 't2' },
};
const LIKELY: CheckItem = { group: 'choice', code: 'SECRET_LIKELY', kind: 'email', item: 'Welcome to Fernhill', field: 'HTML', message: '', answer: { choices: ['clear', 'keep'], target: 't3' } };

const PLAN: SavePlan = {
  key: 'fernhill-ops',
  version: '1.0.0',
  lineage: 'new',
  label: 'Fernhill main',
  minAdminiumVersion: '0.3.49',
  ready: false,
  problems: [],
  counts: { tables: 30 },
  check: [
    SECRET,
    NO_TYPE,
    LIKELY,
    { group: 'after', code: 'RULE_WEBHOOK', kind: 'automation', item: 'Post wholesale orders to Slack', message: '' },
    { group: 'after', code: 'SENDER', kind: 'email', item: 'Welcome', message: '' },
    { group: 'after', code: 'SENDER', kind: 'email', item: 'Order confirmation', message: '' },
    { group: 'after', code: 'SYSTEM_GRANT', kind: 'role', item: 'Finance', message: '' },
    { group: 'info', code: 'WILDCARD_NARROWED', kind: 'role', item: 'Roasters', message: '' },
    { group: 'info', code: 'BUILTIN_ROLE_CHANGED', kind: 'role', item: 'Staff', message: '' },
  ],
};

function Check({ answered = false }: { answered?: boolean }): ReactNode {
  const base = draftFromInventory(INVENTORY, { name: 'Fernhill Ops', key: 'fernhill-ops' });
  const [draft, setDraft] = useState<SaveDraft>(answered ? { ...base, answers: { a: { item: NO_TYPE, choice: 'carry-as-text' } } } : base);
  const plan = answered ? { ...PLAN, check: PLAN.check.filter((item) => item !== NO_TYPE) } : PLAN;
  const props: SaveFlowShared = {
    databases: [],
    connectionId: 'con_f',
    inventory: INVENTORY,
    inventoryError: null,
    draft,
    setDraft,
    saves: [],
    plan,
    planPending: false,
    planError: null,
    save: () => undefined,
    saving: false,
    saveError: null,
    resetSaveError: () => undefined,
    saved: null,
    catalogKeys: new Set(),
    onClose: () => undefined,
  };
  return (
    <div className="max-w-[880px] p-6 leading-[normal]">
      <SaveAppCheck {...props} onBackToInclude={() => undefined} />
    </div>
  );
}

/**
 * "More choices for fernhill": the wizard in choices mode, in the xl modal the
 * Workspaces card opens over Save workspace, with the row's name, key and version.
 */
function Choices({ step }: { step: WizardStep }): ReactNode {
  const [client] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    c.setQueryData(['bootstrap'], makeBootstrap({ systemActions: ['manifests.manage', 'settings.manage'] as never }));
    return c;
  });
  const [draft, setDraft] = useState<SaveDraft>(() => ({ ...draftFromInventory(INVENTORY, { name: 'Fernhill Ops', key: 'fernhill-ops' }), version: '1.0.1' }));
  const props: SaveFlowShared = {
    databases: WITH_CHIPS.slice(0, 1),
    connectionId: 'con_f',
    inventory: INVENTORY,
    inventoryError: null,
    draft,
    setDraft,
    saves: [],
    plan: step === 3 ? PLAN : undefined,
    planPending: false,
    planError: null,
    save: () => undefined,
    saving: false,
    saveError: null,
    resetSaveError: () => undefined,
    saved: null,
    catalogKeys: new Set(),
    onClose: () => undefined,
    applying: true,
    apply: () => undefined,
  };
  return (
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <Modal open size="xl" onOpenChange={() => undefined}>
          <ModalHeader title={t('studio:workspaceFiles.save.choicesTitle', 'More choices for {database}', { database: 'fernhill' })} closeLabel={t('common.close', 'Close')} />
          <ModalBody className="pb-0">
            <SaveAppWizard {...props} step={step} onStep={() => undefined} onConnection={() => undefined} />
          </ModalBody>
        </Modal>
      </AppToastProvider>
    </QueryClientProvider>
  );
}

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Studio/Apps/Save as app' };
export default meta;

export const DatabaseWithWorkspaceChips = { tags: ['vrt'], render: () => <Database databases={WITH_CHIPS} /> };
export const DatabaseWithoutWorkspaces = {
  tags: ['vrt'],
  render: () => <Database databases={WITH_CHIPS.map((row) => ({ ...row, workspaces: [], other: false }))} />,
};
export const CheckBlocksSaving = { tags: ['vrt'], render: () => <Check /> };
export const CheckAnswered = { tags: ['vrt'], render: () => <Check answered /> };
export const ChoicesWhatToInclude = { tags: ['vrt'], render: () => <Choices step={1} /> };
export const ChoicesAboutTheApp = { tags: ['vrt'], render: () => <Choices step={2} /> };
export const ChoicesCheckUseThese = { tags: ['vrt'], render: () => <Choices step={3} /> };
