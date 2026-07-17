/**
 * The 11-electron.md §8.2 gating matrix, row by row (`app/capabilities.ts`).
 *
 * These are the decisions the pages defer to, so they are asserted here once
 * rather than re-derived in every page suite. The negative assertions matter as
 * much as the positive ones: several rows are about what must NOT be folded
 * together (email vs network, gating vs presentation).
 */
import { describe, expect, it } from 'vitest';

import { emailSendGate, isHostedPlanSurface, llmAffordances } from './capabilities.js';

describe('emailSendGate — §8.2 email row', () => {
  it('enables sends only when SMTP is configured', () => {
    expect(emailSendGate({ smtpConfigured: true, networkFeaturesAllowed: true })).toEqual({
      enabled: true,
      reason: null,
    });
    expect(emailSendGate({ smtpConfigured: false, networkFeaturesAllowed: true })).toEqual({
      enabled: false,
      reason: 'smtp-not-configured',
    });
  });

  /**
   * The deployment this protects: an air-gapped install with an SMTP relay on
   * its own LAN. §7's email row asks for "user-configured SMTP" and says nothing
   * about the internet, so folding the flags together would break a setup that
   * works.
   */
  it('does not consult networkFeaturesAllowed — a LAN relay needs no internet', () => {
    expect(emailSendGate({ smtpConfigured: true, networkFeaturesAllowed: false }).enabled).toBe(true);
  });

  it('always carries a reason when disabled, so a caller can explain', () => {
    const gate = emailSendGate({ smtpConfigured: false, networkFeaturesAllowed: true });
    expect(gate.reason).not.toBeNull();
  });
});

describe('llmAffordances — §8.2 LLM row', () => {
  it('leads with BYO on desktop, and keeps the provider API available', () => {
    const { providerApi, byoFirst } = llmAffordances({ runtime: 'desktop', networkFeaturesAllowed: true });
    expect(byoFirst).toBe(true);
    // "Available, labeled" — desktop-ness alone must not disable the direct path.
    expect(providerApi.enabled).toBe(true);
  });

  it('leads with the provider on a normal self-host', () => {
    expect(llmAffordances({ runtime: 'self-host', networkFeaturesAllowed: true }).byoFirst).toBe(false);
  });

  it('disables the provider API — with a reason — on an air-gapped install', () => {
    const { providerApi, byoFirst } = llmAffordances({ runtime: 'self-host', networkFeaturesAllowed: false });
    expect(providerApi).toEqual({ enabled: false, reason: 'network-disabled' });
    // Leading with a card that cannot work is an invitation to a dead end.
    expect(byoFirst).toBe(true);
  });

  /**
   * BYO makes zero network calls (06-llm-assist.md, §7's LLM row), so no flag
   * may ever turn it off. `byoFirst` is presentation; it is not a gate.
   */
  it('never gates BYO itself in any combination', () => {
    for (const runtime of ['self-host', 'desktop'] as const) {
      for (const networkFeaturesAllowed of [true, false]) {
        const affordances = llmAffordances({ runtime, networkFeaturesAllowed });
        expect(Object.keys(affordances)).toEqual(['providerApi', 'byoFirst']);
        expect(typeof affordances.byoFirst).toBe('boolean');
      }
    }
  });
});

describe('isHostedPlanSurface — §8.2 hosted-plan row', () => {
  it('treats the billing "suspended" state as a Cloud-only surface', () => {
    expect(isHostedPlanSurface('suspended')).toBe(true);
  });

  it('leaves every other system state alone', () => {
    for (const stateId of ['not-found', 'forbidden', 'error', 'db-unreachable', 'offline', 'read-only']) {
      expect(isHostedPlanSurface(stateId)).toBe(false);
    }
  });
});

/**
 * The unresolved-flags defaults are deliberately NOT pinned here. They are
 * module-private (`useCapabilities` is the only reader, and it reports
 * `resolved` alongside them), and asserting the constant would only restate it.
 * What matters is the BEHAVIOUR they produce while the probe is in flight or
 * after it fails, and that is pinned where it can actually go wrong, against the
 * real components:
 *
 *  - `auth/forgotSmtpGate.test.tsx` — a failed probe leaves password reset live
 *    instead of asserting "no email server configured" about a healthy instance.
 *  - `shell/runtimeChipHost.test.tsx` — no chip until the runtime is known, and
 *    none at all when the health poll is refused.
 *  - `studio/ai/studioAiLocalMode.test.tsx` — the panel order on each runtime.
 */
