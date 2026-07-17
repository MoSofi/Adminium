/**
 * Settings → Desktop → "Share on local network" (11-electron.md §8.3).
 *
 * The toggle, the port, and the share panel it opens. Everything mechanical
 * lives elsewhere on purpose — `desktop/lanShare.ts` holds the two feeds and the
 * pure `lanShareView` precedence, main owns the rebind — so what is left here is
 * the part that is genuinely about the screen.
 *
 * ─── The three rules this card exists to keep ────────────────────────────────
 *
 * 1. **It shows the socket, not the switch.** Everything below the toggle is
 *    driven by `lanShareView(config, status.active)`, and `active` is the
 *    server's own bind address. A panel that listed URLs because a checkbox was
 *    ticked would hand out addresses that nothing is listening on — the one
 *    output that makes this feature worse than not having it.
 * 2. **The transport sentence is not a tooltip.** §8.3 fixes the copy and this
 *    renders it in the panel body, at rest, next to the URLs it is about — not
 *    behind a hover, an info icon, or a "learn more". It is the reason the user
 *    might decide not to do this.
 * 3. **A collision changes nothing.** §8.3's "inline error with a 'Try 4601'
 *    suggestion" is only possible because main probes BEFORE it writes or
 *    restarts; this card renders that rejection in place, with the suggested
 *    port as a button, and no state has moved.
 *
 * ─── MISSING ON PURPOSE: §8.3's "Manage users & roles" link ──────────────────
 *
 * §8.3 asks the panel for a link to the Roles & Permissions surface. That
 * surface does not exist in this build: `apps/server/src/routes/roles/` is
 * there, but `apps/dashboard` has no users or roles page and `app/router.tsx`
 * has no route to give it. The link is therefore omitted rather than pointed at
 * a `/settings/roles` that would render the 404 state — a dead link inside the
 * panel that exists to tell you the truth about your network is worse than an
 * absent one, and "the button is there" is not the same as "the user can manage
 * roles".
 *
 * WHOEVER BUILDS THAT PAGE: add the link to {@link SharePanel}, next to the
 * session count, which is the sentence that motivates it ("2 devices signed in"
 * → "who are they?"). The `otherUsers` count is already fetched here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Network, ShieldAlert, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  FormField,
  IconTile,
  Input,
  Label,
  MonoText,
  Spinner,
  Switch,
} from '@adminium/ui';

import { t } from '../i18n/t.js';
import { desktopErrorCode } from '../lib/desktop-runtime.js';
import { useAppToasts } from '../pages/toasts.js';
import { CopyButton } from '../studio/connect/CopyButton.js';
import {
  DEFAULT_LAN_PORT,
  LAN_SHARE_PANEL_HASH,
  lanPortSuggestion,
  lanShareStatusQuery,
  lanShareView,
  readLanShare,
  setLanShare,
} from './lanShare.js';

export const LAN_SHARE_QUERY_KEY = ['desktop', 'lan-share-config'] as const;

/** A collision, held in state so it can be rendered where it happened. */
interface PortCollision {
  port: number;
  /** §8.3's "Try 4601", or `null` at the top of the range. */
  suggestion: number | null;
}

export function LanShareCard(): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();

  const config = useQuery({
    queryKey: LAN_SHARE_QUERY_KEY,
    queryFn: readLanShare,
    // `config.json` changes through this card or a relaunch; the panel's live
    // numbers come from the server feed below, which polls.
    staleTime: Infinity,
  });

  // The server half. Only asked once we know we are sharing or trying to —
  // it is Super-Admin + loopback only, and a browser tab has no business
  // producing a 403 to render a card it will not show.
  const status = useQuery({ ...lanShareStatusQuery(), enabled: config.data !== null });

  const [portInput, setPortInput] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [collision, setCollision] = useState<PortCollision | null>(null);

  const save = useMutation({
    mutationFn: setLanShare,
    onMutate: () => {
      // A previous collision is about to be re-tested; clearing it here rather
      // than in `onSuccess` keeps a stale "port in use" from sitting under a
      // request that is currently in flight against a different port.
      setCollision(null);
    },
    onSuccess: (_result, next) => {
      void queryClient.invalidateQueries({ queryKey: LAN_SHARE_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['desktop', 'lan-share'] });
      // `system/info`'s `lanShare` is what §8.1's chip reads; the rebind makes
      // the cached copy a lie until it refetches.
      void queryClient.invalidateQueries({ queryKey: ['system', 'info'] });
      setPortInput(null);
      toasts.push({
        variant: 'success',
        title: next.enabled
          ? t('desktop.lan.savedOn', 'Sharing on your local network')
          : t('desktop.lan.savedOff', 'Sharing stopped — Adminium is back to this computer only'),
      });
    },
    onError: (error, next) => {
      // §8.3's collision is the ONE failure with a specific remedy, so it is the
      // one that gets rendered inline instead of thrown at the toast layer.
      // Everything else — an EACCES on a privileged port, a dead bridge — has no
      // suggestion worth making up and says what it says.
      if (desktopErrorCode(error) === 'LAN_PORT_IN_USE') {
        const message = error instanceof Error ? error.message : '';
        setCollision({ port: next.port, suggestion: lanPortSuggestion(message) });
        return;
      }
      toasts.push({
        variant: 'error',
        title: t('desktop.lan.saveFailed', 'Could not change network sharing'),
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });

  const lan = config.data;
  // No bridge ⇒ not the desktop app. The page above this already renders the
  // 404 for that case; this is the belt to its braces, and it keeps the hooks
  // above unconditional.
  if (lan === null || lan === undefined) return null;

  const port = portInput ?? String(lan.port);
  const parsedPort = Number.parseInt(port, 10);
  const portValid = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535;
  const portDirty = portValid && parsedPort !== lan.port;

  const view = lanShareView({ configEnabled: lan.enabled, active: status.data?.active ?? null });

  // `otherUsers` is a FACT about the meta-store, so it is only readable when the
  // probe actually answered — `app/capabilities.ts`'s `resolved` rule, applied
  // to the one number on this card that asserts something.
  //
  // `?? 0` was the bug: `lanShareStatusQuery` is `retry: false` against a route
  // that is Super-Admin + loopback only, so `status.data` stays `undefined`
  // FOREVER on a 403 (any non-super-admin) and on any 5xx (one meta-store blip,
  // no retry). Both landed on "0 other users" — which then told an admin with
  // five teammates "You're the only person with an account" and disabled the
  // toggle until they promised to invite the people they had already invited.
  // Pending and failed are not zero; neither is a reason to state a falsehood.
  const otherUsers = status.isSuccess ? status.data.otherUsers : null;

  // §8.3's precondition: "at least one non-super-admin user exists *or* the
  // admin acknowledges they'll invite users next". Note what it does NOT say —
  // nothing about `singleUser`, which may stay on: auto-login is loopback-only
  // by construction (§5), so a shared machine that skips its own login screen is
  // not a contradiction. Enforced here in the UI, exactly as §8.3 scopes it.
  //
  // The acknowledgement is the escape hatch in BOTH unknown cases, and that is
  // §8.3's own design rather than a workaround: the spec already accepts an
  // admin's word instead of a user count, so an admin whose count we could not
  // read is not worse off than one who has no users — they are in exactly the
  // branch the spec wrote for. What changes is what we SAY to them.
  const preconditionMet = (otherUsers !== null && otherUsers > 0) || acknowledged;

  // Three states, three sentences (§8.2's "never hide, always explain" — an
  // explanation that is wrong does not satisfy it):
  //  - `known-none`  → we asked, nobody else has an account. State it.
  //  - `unavailable` → we asked and got nothing back. Say THAT, not "zero".
  //  - `null`        → sharing is already on, or the probe is still in flight.
  //                    A momentary pending renders nothing rather than flashing
  //                    a warning that is about to be retracted.
  const acknowledgementPrompt: 'known-none' | 'unavailable' | null = lan.enabled
    ? null
    : otherUsers === 0
      ? 'known-none'
      : status.isError
        ? 'unavailable'
        : null;

  const toggle = (next: boolean) => {
    save.mutate({ enabled: next, port: portValid ? parsedPort : lan.port });
  };

  return (
    <Card id={LAN_SHARE_PANEL_HASH}>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<Network />} />
        <h3 className="text-section text-fg">
          {t('desktop.lan.heading', 'Share on local network')}
        </h3>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor="desktop-lan-share" className="text-body font-semibold text-fg">
              {t('desktop.lan.label', 'Let other devices on this network use Adminium')}
            </Label>
            <p id="desktop-lan-description" className="text-body-sm text-fg-muted">
              {t(
                'desktop.lan.description',
                'Other computers, tablets and phones on the same network can open Adminium in a browser and sign in with their own account. Adminium has to stay open on this computer for them to reach it.',
              )}
            </p>
          </div>
          <Switch
            id="desktop-lan-share"
            checked={lan.enabled}
            disabled={save.isPending || (!lan.enabled && !preconditionMet)}
            onCheckedChange={toggle}
            aria-describedby="desktop-lan-description"
            className="mt-0.5 shrink-0"
          />
        </div>

        {acknowledgementPrompt === null ? null : (
          <InviteAcknowledgement reason={acknowledgementPrompt} checked={acknowledged} onChange={setAcknowledged} />
        )}

        <PortField
          value={port}
          invalid={!portValid}
          disabled={save.isPending}
          onChange={(next) => {
            setPortInput(next);
            setCollision(null);
          }}
          onApply={
            portDirty && lan.enabled
              ? () => {
                  save.mutate({ enabled: true, port: parsedPort });
                }
              : null
          }
          applying={save.isPending}
        />

        {collision === null ? null : (
          <Alert
            role="alert"
            tone="danger"
            title={t('desktop.lan.portInUse', 'Port {port} is already in use by another program.', {
              port: String(collision.port),
            })}
            body={
              collision.suggestion === null
                ? t('desktop.lan.portInUseNoSuggestion', 'Nothing was changed. Try a different port.')
                : t('desktop.lan.portInUseHint', 'Nothing was changed — sharing is still off.')
            }
            action={
              collision.suggestion === null ? undefined : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => {
                    const next = collision.suggestion;
                    if (next === null) return;
                    setPortInput(String(next));
                    save.mutate({ enabled: true, port: next });
                  }}
                >
                  {t('desktop.lan.tryPort', 'Try {port}', { port: String(collision.suggestion) })}
                </Button>
              )
            }
          />
        )}

        {view === 'off' ? null : (
          <SharePanel view={view} urls={lan.urls} sessions={status.data?.lanSessions ?? null} />
        )}
      </CardBody>
    </Card>
  );
}

/**
 * §8.3's precondition, as the thing the admin actually has to think about.
 *
 * Rendered only when we have not established that other accounts exist — either
 * because there are genuinely none (`otherUsers === 0`) or because the probe
 * failed and we cannot say. The common case (a team that already has accounts,
 * counted) never sees a checkbox asking it to promise something it has already
 * done. The wording is a promise and not a warning because that is what §8.3
 * makes it: sharing a machine on a network where only you have an account is not
 * dangerous, it is pointless, and the honest reason to stop the user is that
 * they are about to be confused.
 *
 * The two reasons are one component and two sentences rather than two
 * components, because the ACT is identical (§8.3 takes the admin's word) and
 * only the claim differs. Splitting them would duplicate the checkbox to vary a
 * paragraph.
 */
function InviteAcknowledgement(props: {
  /**
   * WHY we are asking. `known-none` is the fact; `unavailable` is the absence of
   * it. They share a checkbox because §8.3 accepts the same answer either way,
   * and they do NOT share a sentence because only one of them is something we
   * know.
   */
  reason: 'known-none' | 'unavailable';
  checked: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-warn-border bg-warn-soft p-3">
      <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-body-sm text-fg">
          {props.reason === 'known-none'
            ? t(
                'desktop.lan.noUsers',
                "You're the only person with an account, so nobody else can sign in yet. Sharing still works — you'll just need to invite people before they can use it.",
              )
            : t(
                'desktop.lan.usersUnknown',
                "Adminium couldn't check who else has an account on this computer. Sharing still works, and anyone with an account can sign in — this check is the only thing that failed.",
              )}
        </p>
        <div className="flex items-center gap-2">
          <Checkbox
            id="desktop-lan-acknowledge"
            checked={props.checked}
            onCheckedChange={props.onChange}
          />
          <Label htmlFor="desktop-lan-acknowledge" className="text-body-sm text-fg">
            {t('desktop.lan.acknowledge', "I understand — I'll invite people next")}
          </Label>
        </div>
      </div>
    </div>
  );
}

/**
 * The port, editable per §8.3 ("port editable; 4600 default").
 *
 * The Apply button appears only when the number changed AND sharing is already
 * on, because those are the only conditions under which the edit does anything
 * immediately: while sharing is off, main's `lanBindingChange` deliberately
 * declines to restart, and the new number simply rides along with the next
 * enable. The alternative — restarting the server on every keystroke in a number
 * field — is not a design anyone survives.
 *
 * `min={1024}`: below that is privileged on macOS and Linux, the child does not
 * run as root, and the bind fails with an EACCES that §8.3's "Try 4601" cannot
 * help with (4601 is privileged too if 4600 was). Refusing it in the form is
 * kinder than discovering it in a restart.
 */
function PortField(props: {
  value: string;
  invalid: boolean;
  disabled: boolean;
  applying: boolean;
  onChange: (next: string) => void;
  onApply: (() => void) | null;
}): ReactNode {
  return (
    <div className="flex items-end gap-2">
      <FormField
        controlId="desktop-lan-port"
        className="max-w-40"
        label={t('desktop.lan.port', 'Port')}
        {...(props.invalid
          ? { error: t('desktop.lan.portInvalid', 'Use a number between 1024 and 65535.') }
          : {
              helper: t('desktop.lan.portHelper', 'Default {port}', { port: String(DEFAULT_LAN_PORT) }),
            })}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={1024}
          max={65535}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      </FormField>
      {props.onApply === null ? null : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mb-6"
          disabled={props.applying || props.invalid}
          onClick={props.onApply}
        >
          {t('desktop.lan.applyPort', 'Change port')}
        </Button>
      )}
    </div>
  );
}

/**
 * §8.3's panel: the URLs, the session count, the transport sentence, the
 * firewall line.
 *
 * `pending` and `mismatch` do not render URLs, and that is the point of taking
 * `view` rather than a boolean — see `lanShareView`.
 */
function SharePanel(props: {
  view: 'sharing' | 'pending' | 'mismatch';
  urls: readonly string[];
  /** `null` while the server has not answered. */
  sessions: number | null;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
      {props.view === 'mismatch' ? (
        <Alert
          role="alert"
          tone="danger"
          title={t('desktop.lan.mismatch', 'Adminium is still reachable on this network')}
          body={t(
            'desktop.lan.mismatchBody',
            'Sharing is switched off, but the server has not released the network yet. Restart Adminium to close it.',
          )}
        />
      ) : null}

      {props.view === 'pending' ? (
        <p className="flex items-center gap-2 text-body-sm text-fg-muted">
          <Spinner size="sm" />
          {t('desktop.lan.pending', 'Starting to share…')}
        </p>
      ) : null}

      {props.view === 'sharing' ? (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-body-sm font-semibold text-fg">
              {t('desktop.lan.urlsHeading', 'Open this on another device')}
            </p>
            {props.urls.length === 0 ? (
              // Sharing, bound, and nothing to hand out: this machine has no
              // non-internal IPv4 interface (Wi-Fi off, cable out). The bind is
              // real, so this is not an error — there is simply no address that
              // reaches it, and saying so is more useful than an empty list.
              <p className="text-body-sm text-fg-muted">
                {t(
                  'desktop.lan.noUrls',
                  "This computer isn't connected to a network right now, so there's no address to share. Connect to Wi-Fi or plug in a cable and this list will fill in.",
                )}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {props.urls.map((url) => (
                  <li key={url} className="flex items-center gap-2">
                    <MonoText className="min-w-0 flex-1 truncate text-body-sm">{url}</MonoText>
                    <CopyButton value={url} label={t('desktop.lan.copyUrl', 'Copy')} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-body-sm text-fg-muted">
            {props.sessions === null
              ? t('desktop.lan.sessionsUnknown', 'Checking who is connected…')
              : t(
                  'desktop.lan.sessions',
                  // ICU plural, and `count` stays a NUMBER — the formatter
                  // selects the branch by numeric category, and a stringified
                  // "1" takes `other` in every locale, which is the kind of bug
                  // that only ever shows up in the language nobody on the team
                  // reads.
                  '{count, plural, =0 {No devices signed in from this network} one {# device signed in from this network} other {# devices signed in from this network}}',
                  { count: props.sessions },
                )}
          </p>
        </>
      ) : null}

      {/*
        §8.3, VERBATIM AND REQUIRED. Not a tooltip, not a "learn more", not
        conditional on the view: the sentence is the reason a user might decide
        against this, and it has to be readable at the moment they are deciding.
        TLS termination is explicitly out of scope for the desktop shell, so this
        is the whole of the product's answer on transport security — there is no
        follow-up screen where it gets better.
      */}
      <Alert
        tone="warn"
        icon={<ShieldAlert />}
        title={t('desktop.lan.transportTitle', 'Traffic on your local network is not encrypted.')}
        body={t(
          'desktop.lan.transportBody',
          'Share only on networks you trust. For remote access, use Adminium self-host behind HTTPS.',
        )}
      />

      {/*
        §8.3's firewall line. One line, as specified — the OS dialog it describes
        appears on first enable and is the single most likely reason a correct
        setup is unreachable anyway.
      */}
      <p className="flex items-start gap-2 text-body-sm text-fg-muted">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {t(
          'desktop.lan.firewall',
          'The first time you share, your operating system will ask whether to allow incoming connections — choose Allow, or other devices will not be able to reach Adminium.',
        )}
      </p>
    </div>
  );
}
