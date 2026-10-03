// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Architecture tab's words for what the server names by id: the sides,
 * the customers, the tiles of what comes with Adminium, the kinds of line.
 * The server's own labels (role and table names, sentences from the
 * manifest) are the app's data and stay as they are.
 */
import { ArrowLeftRight, Braces, ChartColumn, KeyRound, Upload, Zap, type LucideIcon } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { ArchitectureDoc, ArchitectureEdgeKind, BuiltIn } from '../api.js';

export function useLabel(id: ArchitectureDoc['uses'][number]['id']): string {
  switch (id) {
    case 'dashboard':
      return t('designer:arch.dashboard', 'Dashboard');
    case 'staff':
      return t('designer:arch.staffSide', 'Staff side');
    case 'customer':
      return t('designer:arch.customerSide', 'Customer side');
  }
}

export function nodeLabel(person: ArchitectureDoc['people'][number]): string {
  return person.kind === 'customers' ? t('designer:arch.customers', 'Customers') : person.label;
}

export function builtInLabel(tile: BuiltIn): string {
  switch (tile) {
    case 'sign-in':
      return t('designer:arch.signIn', 'Sign-in and roles');
    case 'files':
      return t('designer:arch.files', 'File uploads');
    case 'automations':
      return t('designer:arch.automations', 'Automations');
    case 'import-export':
      return t('designer:arch.importExport', 'Import and export');
    case 'reports':
      return t('designer:arch.reports', 'Reports');
    case 'api':
      return t('designer:arch.api', 'API and API keys');
  }
}

export function builtInIcon(tile: BuiltIn): LucideIcon {
  switch (tile) {
    case 'sign-in':
      return KeyRound;
    case 'files':
      return Upload;
    case 'automations':
      return Zap;
    case 'import-export':
      return ArrowLeftRight;
    case 'reports':
      return ChartColumn;
    case 'api':
      return Braces;
  }
}

/** Where a tile of what comes with Adminium opens in the dashboard. */
export function builtInPath(tile: BuiltIn): string {
  switch (tile) {
    case 'sign-in':
      return '/settings/roles';
    case 'files':
      return '/files';
    case 'automations':
      return '/automations';
    case 'import-export':
      return '/imports';
    case 'reports':
      return '/reports';
    case 'api':
      return '/studio/public-api';
  }
}

export function kindLabel(kind: ArchitectureEdgeKind): string {
  switch (kind) {
    case 'session':
      return t('designer:arch.kindSession', 'Signs in');
    case 'customer-key':
      return t('designer:arch.kindKey', 'Through a customer key');
    case 'uses':
      return t('designer:arch.kindUses', 'Uses');
    case 'relation':
      return t('designer:arch.kindRelation', 'One to many');
    case 'add-on':
      return t('designer:arch.kindAddOn', 'Add-on');
    case 'email':
      return t('designer:arch.kindEmail', 'Sends');
  }
}
