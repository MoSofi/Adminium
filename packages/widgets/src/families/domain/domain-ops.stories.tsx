// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK OPS stories (annex §13) — the eighteen ops / billing / API / marketing
 * cards that close the annex catalog: the four WidgetFrame states through
 * WidgetHost (acceptance #4), a light/dark × LTR/RTL matrix (acceptance #9), and
 * a grouped gallery per concern so all eighteen are captured without eighteen
 * near-identical story files.
 *
 * REAL GEOMETRY MIRRORING — the RTL stories are not a bare `dir` attribute; they
 * pass Arabic copy AND an `ar-EG` locale, so the captures exercise the real Intl
 * path (the numeral policy, the relative stamps, the currency placement) rather
 * than only flipping a flex row. The contrasts these captures exist to catch:
 *
 *   - `slo-monitor-card` MIRRORS AS ONE UNIT. Its status rule rides `border-s-*`
 *     and its uptime strip is a plain flex row, so under RTL the rule moves to
 *     the other edge and "newest" stays at the reading END. A capture where the
 *     strip kept "newest" on the physical right is the bug.
 *   - THE LTR ISLANDS DO NOT MIRROR, and that contrast is the point: the code in
 *     `code-snippet-block`, the URL in `webhook-endpoints-list` and the IP
 *     literals in `ip-allowlist-card` stay `dir="ltr"` under an RTL page, because
 *     a reordered shell command does not run and a reordered IP does not resolve.
 *     Their surrounding chrome mirrors; their content must not.
 *   - `live-timer` is captured RUNNING under a PINNED clock. A pinned
 *     `format.referenceTime` means the component never starts its interval, so
 *     the readout is a pure function of config + data and the capture is
 *     byte-stable. Without the pin these frames would drift every screenshot.
 *
 * Every payload is the same seeded generator `demoData` uses, pinned to seed 7
 * and the fixed `OPS_DEMO_NOW_MS`, so captures are byte-deterministic (no
 * wall-clock read anywhere in the slice).
 *
 * Widgets resolve through a LOCAL registry override so the stories work
 * independently of the global map's assembly order.
 */
import type { ReactNode } from 'react';

import {
  OPS_DEMO_NOW_MS,
  apiKeysPanelDemoData,
  apiPlaygroundDemoData,
  codeSnippetBlockDemoData,
  creditCardTileDemoData,
  experimentVariantCompareDemoData,
  ipAllowlistCardDemoData,
  liveTimerDemoData,
  onboardingChecklistDemoData,
  planPricingCardsDemoData,
  policyListDemoData,
  resourceApiCardDemoData,
  sloMonitorCardDemoData,
  starterTemplatePickerDemoData,
  syncStatusCardDemoData,
  testimonialCardDemoData,
  trustBadgesDemoData,
  uptimeSegmentBarDemoData,
  webhookEndpointsListDemoData,
} from './domain-ops-config.js';
import { domainOpsTrackDefinitions } from './domain-ops-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';

const registry = buildRegistry(domainOpsTrackDefinitions);

const meta = { title: 'Widgets/Domain/Ops cards' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  width = 'w-[26rem]',
) {
  return (
    <div className={width} key={instanceId}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="flex flex-wrap items-start gap-4 bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const SEED = 7;

/**
 * The pinned clock every story runs against. `live-timer` reads it instead of
 * starting its 1s interval, and the relative stamps ("2 hours ago") land in a
 * fixed place — which is what makes these captures reproducible.
 */
const en = { format: { locale: 'en-US', currency: 'USD', referenceTime: OPS_DEMO_NOW_MS } };
const ar = { format: { locale: 'ar-EG', currency: 'USD', referenceTime: OPS_DEMO_NOW_MS } };

// ── monitoring ──────────────────────────────────────────────────────────────

export const Monitoring = {
  name: 'monitoring — SLO / uptime / sync / timer',
  render: () => (
    <Frame>
      {host('slo-monitor-card', 's-slo', en, sloMonitorCardDemoData(SEED))}
      {host('uptime-segment-bar', 's-usb', en, uptimeSegmentBarDemoData(SEED), 'success', 'w-[34rem]')}
      {host('sync-status-card', 's-sync', en, syncStatusCardDemoData(SEED))}
      {/* Explicitly RUNNING — the accent→danger restyle and the square stop icon. */}
      {host(
        'live-timer',
        's-timer-running',
        en,
        { row: { task_name: 'Schema review', project: 'Adminium', running: true, elapsed_sec: 3600, started_at: OPS_DEMO_NOW_MS - 754_000 } },
        'success',
        'w-[34rem]',
      )}
      {host('live-timer', 's-timer-idle', en, liveTimerDemoData(3), 'success', 'w-[34rem]')}
    </Frame>
  ),
};

/** A monitor whose budget is spent — the threshold tones the whole card. */
export const SloBudgetExhausted = {
  name: 'slo-monitor-card — budget exhausted (danger thresholds)',
  render: () => (
    <Frame>
      {host('slo-monitor-card', 's-slo-ok', en, sloMonitorCardDemoData(SEED))}
      {host('slo-monitor-card', 's-slo-warn', en, {
        row: { ...(sloMonitorCardDemoData(SEED).row ?? {}), budget: 34, status: 'degraded', current: 99.2 },
      })}
      {host('slo-monitor-card', 's-slo-danger', en, {
        row: { ...(sloMonitorCardDemoData(SEED).row ?? {}), budget: 4, status: 'down', current: 97.1 },
      })}
    </Frame>
  ),
};

// ── billing / experiments ───────────────────────────────────────────────────

export const Billing = {
  name: 'billing — card tile / variants / pricing',
  render: () => (
    <Frame>
      {host('credit-card-tile', 's-cc', en, creditCardTileDemoData(SEED), 'success', 'w-[20rem]')}
      {host('credit-card-tile', 's-cc-row', { ...en, variant: 'row' }, creditCardTileDemoData(2), 'success', 'w-[20rem]')}
      {host('credit-card-tile', 's-cc-ghost', { ...en, variant: 'ghost' }, creditCardTileDemoData(4), 'success', 'w-[20rem]')}
      {host('experiment-variant-compare', 's-exp', en, experimentVariantCompareDemoData(SEED), 'success', 'w-[34rem]')}
      {host('plan-pricing-cards', 's-plans', en, planPricingCardsDemoData(SEED), 'success', 'w-[44rem]')}
      {host('plan-pricing-cards', 's-plans-annual', { ...en, period: 'annual' }, planPricingCardsDemoData(SEED), 'success', 'w-[44rem]')}
    </Frame>
  ),
};

// ── API surface ─────────────────────────────────────────────────────────────

export const ApiSurface = {
  name: 'api — keys / playground / snippet / hooks / resource',
  render: () => (
    <Frame>
      {host('api-keys-panel', 's-keys', en, apiKeysPanelDemoData(SEED), 'success', 'w-[34rem]')}
      {/* The one-time post-create reveal banner (annex) — a config value, never a column. */}
      {host(
        'api-keys-panel',
        's-keys-revealed',
        { ...en, revealedSecret: 'sk_live_51H8kQ2eZvKYlo2C9x7fN3pQ' },
        apiKeysPanelDemoData(SEED),
        'success',
        'w-[34rem]',
      )}
      {host('api-playground', 's-play', en, apiPlaygroundDemoData(SEED), 'success', 'w-[34rem]')}
      {host('code-snippet-block', 's-snip', en, codeSnippetBlockDemoData(SEED), 'success', 'w-[30rem]')}
      {/* Tabbed variant — templates supply the tab set and the code. */}
      {host(
        'code-snippet-block',
        's-snip-tabs',
        {
          ...en,
          languages: ['cURL', 'JavaScript', 'Python'],
          templates: {
            cURL: "curl https://api.adminium.app/v1/orders \\\n  -H 'Authorization: Bearer sk_live_…'",
            JavaScript: "const res = await fetch('https://api.adminium.app/v1/orders', {\n  headers: { Authorization: `Bearer ${key}` },\n});",
            Python: "import httpx\n\nres = httpx.get('https://api.adminium.app/v1/orders')",
          },
        },
        undefined,
        'success',
        'w-[30rem]',
      )}
      {host('webhook-endpoints-list', 's-hooks', en, webhookEndpointsListDemoData(SEED), 'success', 'w-[30rem]')}
      {host('resource-api-card', 's-res', en, resourceApiCardDemoData(SEED), 'success', 'w-[20rem]')}
    </Frame>
  ),
};

// ── access / trust / onboarding ─────────────────────────────────────────────

export const Trust = {
  name: 'trust — policies / IPs / badges / testimonial',
  render: () => (
    <Frame>
      {host('policy-list', 's-pol', en, policyListDemoData(SEED), 'success', 'w-[30rem]')}
      {host('ip-allowlist-card', 's-ips', en, ipAllowlistCardDemoData(SEED), 'success', 'w-[22rem]')}
      {host('trust-badges', 's-badges', en, trustBadgesDemoData(SEED), 'success', 'w-[34rem]')}
      {host('testimonial-card', 's-quote', en, testimonialCardDemoData(SEED), 'success', 'w-[24rem]')}
    </Frame>
  ),
};

export const Onboarding = {
  name: 'onboarding — starters / checklist',
  render: () => (
    <Frame>
      {host('starter-template-picker', 's-start', en, starterTemplatePickerDemoData(SEED), 'success', 'w-[38rem]')}
      {host('onboarding-checklist', 's-check', en, onboardingChecklistDemoData(SEED), 'success', 'w-[30rem]')}
      {/* The celebrate state (annex `celebrateOnComplete`) — every step done. */}
      {host(
        'onboarding-checklist',
        's-check-done',
        { ...en, celebrateTitle: 'You are all set', celebrateBody: 'Every setup step is done.' },
        {
          rows: (onboardingChecklistDemoData(SEED).rows ?? []).map((row) => ({ ...row, done: true })),
          total: onboardingChecklistDemoData(SEED).total,
        },
        'success',
        'w-[30rem]',
      )}
    </Frame>
  ),
};

// ── four WidgetFrame states (acceptance #4) ────────────────────────────────

export const OpsStates = {
  name: 'ops — four states (SLO / keys / checklist)',
  render: () => (
    <Frame>
      {host('slo-monitor-card', 's-st-loaded', en, sloMonitorCardDemoData(SEED), 'success', 'w-[24rem]')}
      {host('slo-monitor-card', 's-st-skeleton', en, undefined, 'loading', 'w-[24rem]')}
      {host('slo-monitor-card', 's-st-empty', { ...en }, { row: null }, 'success', 'w-[24rem]')}
      {host('slo-monitor-card', 's-st-error', en, undefined, 'error', 'w-[24rem]')}

      {host('api-keys-panel', 's-k-loaded', en, apiKeysPanelDemoData(SEED), 'success', 'w-[24rem]')}
      {host('api-keys-panel', 's-k-skeleton', en, undefined, 'loading', 'w-[24rem]')}
      {host('api-keys-panel', 's-k-empty', en, { rows: [], total: 0 }, 'success', 'w-[24rem]')}
      {host('api-keys-panel', 's-k-error', en, undefined, 'error', 'w-[24rem]')}

      {host('onboarding-checklist', 's-c-loaded', en, onboardingChecklistDemoData(SEED), 'success', 'w-[24rem]')}
      {host('onboarding-checklist', 's-c-skeleton', en, undefined, 'loading', 'w-[24rem]')}
      {host('onboarding-checklist', 's-c-empty', en, { rows: [], total: 0 }, 'success', 'w-[24rem]')}
      {host('onboarding-checklist', 's-c-error', en, undefined, 'error', 'w-[24rem]')}
    </Frame>
  ),
};

// ── theme × direction matrix (acceptance #9) ───────────────────────────────

/** The mirroring cases: the SLO rule + strip, the money card, the checklist. */
export const MatrixLtrLight = {
  name: 'matrix — LTR light',
  render: () => (
    <Frame dir="ltr">
      {host('slo-monitor-card', 'm-ll-slo', en, sloMonitorCardDemoData(SEED), 'success', 'w-[24rem]')}
      {host('credit-card-tile', 'm-ll-cc', en, creditCardTileDemoData(SEED), 'success', 'w-[20rem]')}
      {host('onboarding-checklist', 'm-ll-c', en, onboardingChecklistDemoData(SEED), 'success', 'w-[24rem]')}
      {host('testimonial-card', 'm-ll-q', en, testimonialCardDemoData(SEED), 'success', 'w-[22rem]')}
    </Frame>
  ),
};

export const MatrixLtrDark = {
  name: 'matrix — LTR dark',
  render: () => (
    <Frame dark dir="ltr">
      {host('slo-monitor-card', 'm-ld-slo', en, sloMonitorCardDemoData(SEED), 'success', 'w-[24rem]')}
      {host('credit-card-tile', 'm-ld-cc', en, creditCardTileDemoData(SEED), 'success', 'w-[20rem]')}
      {host('onboarding-checklist', 'm-ld-c', en, onboardingChecklistDemoData(SEED), 'success', 'w-[24rem]')}
      {host('testimonial-card', 'm-ld-q', en, testimonialCardDemoData(SEED), 'success', 'w-[22rem]')}
    </Frame>
  ),
};

/**
 * RTL with REAL Arabic copy and an `ar-EG` locale — not a bare `dir` flip. The
 * status rule, the card chrome and the checklist all mirror; the mono data
 * (percentages, the masked PAN) stays Latin-digit and tabular per the
 * data-context numeral policy (10-i18n-theming.md §4.2).
 */
export const MatrixRtlLight = {
  name: 'matrix — RTL light (ar-EG)',
  render: () => (
    <Frame dir="rtl">
      {host(
        'slo-monitor-card',
        'm-rl-slo',
        { ...ar, targetLabel: 'الهدف', budgetLabel: 'ميزانية الأخطاء', latencyLabel: 'زمن الاستجابة p95' },
        sloMonitorCardDemoData(SEED),
        'success',
        'w-[24rem]',
      )}
      {host(
        'credit-card-tile',
        'm-rl-cc',
        { ...ar, defaultLabel: 'الافتراضية', setDefaultLabel: 'تعيين كافتراضية', expiresLabel: 'تنتهي' },
        creditCardTileDemoData(SEED),
        'success',
        'w-[20rem]',
      )}
      {host(
        'onboarding-checklist',
        'm-rl-c',
        { ...ar, progressLabel: 'تم {done} من {total}' },
        onboardingChecklistDemoData(SEED),
        'success',
        'w-[24rem]',
      )}
      {host('testimonial-card', 'm-rl-q', ar, testimonialCardDemoData(SEED), 'success', 'w-[22rem]')}
    </Frame>
  ),
};

export const MatrixRtlDark = {
  name: 'matrix — RTL dark (ar-EG)',
  render: () => (
    <Frame dark dir="rtl">
      {host(
        'slo-monitor-card',
        'm-rd-slo',
        { ...ar, targetLabel: 'الهدف', budgetLabel: 'ميزانية الأخطاء', latencyLabel: 'زمن الاستجابة p95' },
        sloMonitorCardDemoData(SEED),
        'success',
        'w-[24rem]',
      )}
      {host(
        'credit-card-tile',
        'm-rd-cc',
        { ...ar, defaultLabel: 'الافتراضية', setDefaultLabel: 'تعيين كافتراضية', expiresLabel: 'تنتهي' },
        creditCardTileDemoData(SEED),
        'success',
        'w-[20rem]',
      )}
      {host(
        'onboarding-checklist',
        'm-rd-c',
        { ...ar, progressLabel: 'تم {done} من {total}' },
        onboardingChecklistDemoData(SEED),
        'success',
        'w-[24rem]',
      )}
      {host('testimonial-card', 'm-rd-q', ar, testimonialCardDemoData(SEED), 'success', 'w-[22rem]')}
    </Frame>
  ),
};

/**
 * The LTR ISLANDS under RTL — the regression this story exists to catch. The
 * chrome around each mirrors; the code, the URLs and the IP literals must NOT.
 */
export const LtrIslandsUnderRtl = {
  name: 'matrix — LTR islands under RTL (code / URLs / IPs)',
  render: () => (
    <Frame dir="rtl">
      {host(
        'code-snippet-block',
        'm-r-snip',
        { ...ar, copyLabel: 'نسخ', copiedLabel: 'تم النسخ' },
        codeSnippetBlockDemoData(SEED),
        'success',
        'w-[30rem]',
      )}
      {host(
        'webhook-endpoints-list',
        'm-r-hooks',
        { ...ar, neverFiredLabel: 'لم يُشغَّل بعد', lastFiredLabel: 'آخر تشغيل {since}', enableLabel: 'تفعيل' },
        webhookEndpointsListDemoData(SEED),
        'success',
        'w-[30rem]',
      )}
      {host(
        'ip-allowlist-card',
        'm-r-ips',
        { ...ar, copyLabel: 'نسخ', copiedLabel: 'تم النسخ' },
        ipAllowlistCardDemoData(SEED),
        'success',
        'w-[22rem]',
      )}
      {host(
        'api-keys-panel',
        'm-r-keys',
        { ...ar, neverUsedLabel: 'لم يُستخدم', lastUsedLabel: 'آخر استخدام {since}' },
        apiKeysPanelDemoData(SEED),
        'success',
        'w-[30rem]',
      )}
    </Frame>
  ),
};
