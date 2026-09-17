// SPDX-License-Identifier: AGPL-3.0-only
/**
 * *Insert variable* (comp 654, 741; D18): dashed accent chips that APPEND
 * the token to the last-focused field, under the comp's hint. Insertion at
 * the caret is a refinement recorded, not built.
 */
import { t } from '../../../i18n/t.js';
import { PanelLabel } from './parts.js';

export function VariablesBox({ vars, onInsert }: { vars: readonly string[]; onInsert: (token: string) => void }) {
  if (vars.length === 0) return null;
  return (
    <div data-testid="email-variables-box" className="mt-0.5 border-t border-border pt-3.5">
      <PanelLabel className="mb-2">{t('email:inspector.insertVariable', 'Insert variable')}</PanelLabel>
      <div className="flex flex-wrap gap-1.5">
        {vars.map((name) => {
          const token = `{{${name}}}`;
          return (
            <button
              key={name}
              type="button"
              data-testid="email-var-chip"
              onClick={() => onInsert(token)}
              className="rounded-[7px] border border-dashed border-accent bg-accent-soft px-[9px] py-1 font-mono text-[11px] font-bold text-accent"
            >
              {token}
            </button>
          );
        })}
      </div>
      <span className="mt-1.5 block text-[10px] text-fg-subtle">{t('email:inspector.insertHint', 'Click a field, then a variable to insert it.')}</span>
    </div>
  );
}
