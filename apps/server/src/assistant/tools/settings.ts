// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The workspace tools: the handful of settings a draft has to agree with, and
 * the variables an email document may use.
 *
 * `workspace_settings` reads an ALLOW-LIST and nothing else. Not a deny-list:
 * a deny-list is a promise that somebody remembered every secret, and this
 * store holds an encrypted provider key, SMTP credentials and storage secrets.
 * A key added by a future wave is invisible here until someone adds it on
 * purpose, which is the behaviour worth having.
 */

import { settingsRepo, userPrefsRepo, type SettingKey } from '@adminium/meta';

import { documentVars } from '../../email/document.js';
import { isEmailStarterKey, STARTER_VARS } from '../../email/starters.js';
import { TEMPLATE_NUMBER } from '../../invoices/numbering.js';
import type { AssistantTool } from '../types.js';

/**
 * Every setting that may be shown to the model, with the name it travels
 * under. This list IS the boundary — the tool reads nothing that is not on
 * it — and it is an allow-list rather than a deny-list because a deny-list is
 * a promise that somebody remembered every secret, and this store holds an
 * encrypted provider key, SMTP credentials and storage secrets.
 *
 * `email.senders` is here but only reaches the email page: an address list is
 * contact data, and no other page's draft can name one.
 */
const READABLE_SETTINGS: readonly {
  key: SettingKey;
  as: string;
  contexts?: readonly string[];
}[] = [
  { key: 'branding.appName', as: 'appName' },
  { key: 'appearance.accent', as: 'brandingAccent' },
  { key: 'locale.default', as: 'defaultLocale' },
  { key: 'email.senders', as: 'senders', contexts: ['email'] },
];

export const workspaceSettingsTool: AssistantTool = {
  name: 'workspace_settings',
  description:
    'The workspace facts a draft has to agree with: the application name, the accent colour, the default language, and — on the email page — the addresses it may send from.',
  args: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, deps) {
    const settings = settingsRepo(deps.meta);
    const result: Record<string, unknown> = {};
    for (const entry of READABLE_SETTINGS) {
      if (entry.contexts !== undefined && !entry.contexts.includes(deps.context)) continue;
      const value = await settings.get(entry.key);
      result[entry.as] =
        entry.key === 'email.senders'
          ? (value as { address: string; name: string }[]).map((sender) => ({
              address: sender.address,
              name: sender.name,
            }))
          : value;
    }
    // Not a setting: whose language the answer is written in.
    result.locale = (await userPrefsRepo(deps.meta).resolve(deps.userId)).locale;
    if (deps.context === 'invoice-template' || deps.context === 'invoices') {
      // What a template's number looks like before one is minted, so the model
      // writes the shape rather than inventing a serial.
      result.numbering = { templatePlaceholder: TEMPLATE_NUMBER, mintedOnSave: true };
    }
    return { result };
  },
};

export const emailVariablesTool: AssistantTool = {
  name: 'email_variables',
  description:
    'The `{{variables}}` an email document may use. A variable not in this list renders as literal text, so only use these.',
  args: {
    type: 'object',
    properties: {
      basedOn: { type: 'string', description: 'The key of the document being written, when there is one.' },
      starter: { type: 'string', description: 'The starter it was built from, when there is one.' },
    },
    additionalProperties: false,
  },
  async run(args) {
    const key = typeof args.basedOn === 'string' ? args.basedOn : '';
    const starterArg = typeof args.starter === 'string' ? args.starter : '';
    const starter = isEmailStarterKey(starterArg) ? starterArg : null;
    return {
      result: {
        variables: documentVars(key, starter),
        starterVariables: starter === null ? [] : STARTER_VARS[starter],
        syntax: '{{variable}}',
      },
    };
  },
};
