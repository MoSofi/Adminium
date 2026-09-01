// SPDX-License-Identifier: AGPL-3.0-only
import { MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { BlockEmpty } from './BlockShell.js';
import {
  blockEmailButtonConfigSchema,
  blockEmailDividerConfigSchema,
  blockEmailFooterConfigSchema,
  blockEmailHeadingConfigSchema,
  blockEmailSpacerConfigSchema,
  blockEmailTextConfigSchema,
} from './blocks-config.js';
import type {
  BlockEmailButtonConfig,
  BlockEmailDividerConfig,
  BlockEmailFooterConfig,
  BlockEmailHeadingConfig,
  BlockEmailSpacerConfig,
  BlockEmailTextConfig,
} from './blocks-config.js';
import type { WidgetProps } from '../../registry/types.js';

export {
  blockEmailButtonConfigSchema,
  blockEmailDividerConfigSchema,
  blockEmailFooterConfigSchema,
  blockEmailHeadingConfigSchema,
  blockEmailSpacerConfigSchema,
  blockEmailTextConfigSchema,
};

/**
 * TRACK BUILDER — the six TRANSACTIONAL-EMAIL blocks (`email.heading`,
 * `email.text`, `email.button`, `email.divider`, `email.spacer`,
 * `email.footer`), the canvas half of the vocabulary
 * `apps/server/src/email/render.ts` turns into MIME.
 *
 * THESE READ A BARE PAYLOAD, NOT `RowData`. Every other block in this family
 * goes through `rowOf`/`rowsOf` because its data arrives from a query binding.
 * These do not: their payload is the stored `adminium_email_templates.blocks`
 * entry's own `data` object (`{ text, level }`, `{ label, url }`, `{ size }`),
 * handed straight through by `blockDataForInstance`. Wrapping it in `{ row }`
 * would mean rewriting the wire format the server seeds and sends.
 *
 * NOTHING HERE IS INTERACTIVE. `email.button` renders as a styled SPAN plus its
 * destination in mono, not as an `<a href>`: this is a preview of an email
 * inside an editor, so a real link would navigate away on the click that was
 * meant to select the block, and the URL is usually an unresolved `{{resetUrl}}`
 * placeholder that resolves to nothing anyway. Showing the href as text is also
 * what the comp's inspector does (Button text + Link URL), and it keeps the
 * canvas free of the `nested-interactive` violations the block wrapper fought
 * off once already (see DocumentCanvas's selection note).
 *
 * ALIGNMENT AND COLOUR come from the canvas, which renders an `email` doc
 * inside the `adm-always-light` scope — email clients render light, so the
 * preview must too (@adminium/tokens exceptions.css).
 */

/** The stored block payload as a plain record, or null when there is none. */
function payloadOf(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

/**
 * A non-empty string field, or undefined.
 *
 * Emptiness is judged on the RAW stored string, unlike the renderer's
 * `filledOr` which judges after interpolating `{{vars}}`. The editor has no
 * variable values — showing `{{body}}` verbatim is the point of the surface.
 */
function textField(payload: Record<string, unknown> | null, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

// ── email.heading ───────────────────────────────────────────────────────────

export function BlockEmailHeadingWidget({ config, data }: WidgetProps<BlockEmailHeadingConfig>) {
  const t = useMaybeT();
  const payload = payloadOf(data);
  const text = textField(payload, 'text');
  if (text === undefined) {
    return (
      <BlockEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.blockEmailHeading.emptyTitle', 'No heading')}
        body={config.emptyBody ?? t('ui:widgets.domain.blockEmailHeading.emptyBody', 'Add heading text for this email.')}
      />
    );
  }
  // Level 2 is the only alternative the renderer honours; anything else is h1.
  const level = payload?.['level'] === 2 ? 2 : 1;
  /*
    A <p>, NOT an <h1>/<h2>, even though this renders the email's heading.

    The heading level belongs to the SENT MESSAGE, not to this page: the canvas
    already emits an <h3> block label above every selectable block, so an <h1>
    or <h2> here lands inside it and inverts document order (h3 → h1) — an
    `heading-order` violation on every email template, for a heading that is
    content being previewed rather than structure of the editor. The level is
    kept in `data-level`, which is what the renderer reads and what the tests
    assert; only the visual weight changes.
  */
  return (
    <p
      data-widget="email.heading"
      data-testid={config.testId}
      data-level={String(level)}
      className={level === 2 ? 'text-body-lg font-bold text-fg' : 'text-title font-bold text-fg'}
    >
      {text}
    </p>
  );
}

// ── email.text ──────────────────────────────────────────────────────────────

export function BlockEmailTextWidget({ config, data }: WidgetProps<BlockEmailTextConfig>) {
  const t = useMaybeT();
  const text = textField(payloadOf(data), 'text');
  if (text === undefined) {
    return (
      <BlockEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.blockEmailText.emptyTitle', 'No text')}
        body={config.emptyBody ?? t('ui:widgets.domain.blockEmailText.emptyBody', 'Add a paragraph for this email.')}
      />
    );
  }
  return (
    <p
      data-widget="email.text"
      data-testid={config.testId}
      className="whitespace-pre-line text-body-sm leading-relaxed text-fg"
    >
      {text}
    </p>
  );
}

// ── email.button ────────────────────────────────────────────────────────────

export function BlockEmailButtonWidget({ config, data }: WidgetProps<BlockEmailButtonConfig>) {
  const t = useMaybeT();
  const payload = payloadOf(data);
  const label = textField(payload, 'label');
  const url = textField(payload, 'url');
  // The renderer drops the block unless BOTH are present, so the preview must
  // report the same thing rather than showing a button that will never send.
  if (label === undefined || url === undefined) {
    return (
      <BlockEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.blockEmailButton.emptyTitle', 'Incomplete button')}
        body={config.emptyBody ?? t('ui:widgets.domain.blockEmailButton.emptyBody', 'A button needs both text and a link to be sent.')}
      />
    );
  }
  return (
    <div data-widget="email.button" data-testid={config.testId} className="space-y-1.5">
      <span className="inline-block rounded-lg bg-accent px-6 py-3 text-body-sm font-bold text-accent-fg">
        {label}
      </span>
      <MonoText className="block truncate text-caption text-fg-subtle">{url}</MonoText>
    </div>
  );
}

// ── email.divider ───────────────────────────────────────────────────────────

export function BlockEmailDividerWidget({ config }: WidgetProps<BlockEmailDividerConfig>) {
  // `<hr>` rather than a styled div: it is the semantic element for exactly
  // this, and the renderer's output is a full-width rule.
  return <hr data-widget="email.divider" data-testid={config.testId} className="border-0 border-t border-border" />;
}

// ── email.spacer ────────────────────────────────────────────────────────────

export function BlockEmailSpacerWidget({ config, data }: WidgetProps<BlockEmailSpacerConfig>) {
  const t = useMaybeT();
  const raw = payloadOf(data)?.['size'];
  // The renderer's own clamp, mirrored: 4–64px, default 16.
  const size = typeof raw === 'number' ? Math.min(64, Math.max(4, Math.round(raw))) : 16;
  return (
    // A spacer is invisible by definition, so the EDITOR outlines it — an
    // unmarked gap is indistinguishable from a layout bug to whoever is editing.
    <div
      data-widget="email.spacer"
      data-testid={config.testId}
      data-size={String(size)}
      // The height is data, so it rides a custom property (the one shape
      // `adminium/no-style-prop` allows) and Tailwind reads it back — the
      // `--adm-cols` idiom the matrix widgets already use.
      style={{ '--adm-email-spacer': `${String(size)}px` }}
      className="flex items-center justify-center rounded-sm border border-dashed border-border h-[var(--adm-email-spacer)]"
    >
      <span className="text-micro text-fg-subtle">
        {t('ui:widgets.domain.blockEmailSpacer.label', '{size}px space', { size: String(size) })}
      </span>
    </div>
  );
}

// ── email.footer ────────────────────────────────────────────────────────────

export function BlockEmailFooterWidget({ config, data }: WidgetProps<BlockEmailFooterConfig>) {
  const t = useMaybeT();
  const text = textField(payloadOf(data), 'text');
  if (text === undefined) {
    return (
      <BlockEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.blockEmailFooter.emptyTitle', 'No footer')}
        body={config.emptyBody ?? t('ui:widgets.domain.blockEmailFooter.emptyBody', 'Legal text, address and unsubscribe copy go here.')}
      />
    );
  }
  return (
    <p
      data-widget="email.footer"
      data-testid={config.testId}
      className="whitespace-pre-line break-words text-caption leading-relaxed text-fg-muted"
    >
      {text}
    </p>
  );
}
