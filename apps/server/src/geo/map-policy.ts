// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether maps are on, and where they come from: one answer for everybody.
 *
 * Three things decide it. The operator's `ADMINIUM_MAP_SERVER` (`off` is a
 * no nothing here overrides). The runtime: the desktop app shows no outside
 * map. And the `maps.enabled` setting, where `null` (nobody was asked yet)
 * counts as ON, so the core's own map widget works out of the box; an app's
 * install tick and Settings → Maps turn it off.
 *
 * The content security policy, the bootstrap, Settings → Maps and the route
 * between stops all read this, so the policy can never name a host the
 * dashboard was told is off, nor the other way round.
 *
 * The setting is kept in memory for a short while: the policy is written on
 * every reply. The settings write drops it, so a switch counts at once on
 * this process; a second process behind the same store follows within
 * {@link MAP_SETTING_LIFE_MS}.
 */
import type { SettingValue } from '@adminium/meta';

import { MAP_SERVER_OFF, type Env } from '../config/env.js';

export const MAP_SETTING_LIFE_MS = 30_000;

export interface MapSettingsReader {
  get<K extends 'maps.enabled' | 'maps.routing'>(key: K): Promise<SettingValue<K>>;
}

export interface MapState {
  /** Maps are shown on this install. */
  enabled: boolean;
  /** The map server's origin; null whenever maps are off. */
  server: string | null;
  /** The server may ask the routing server for a route along roads. */
  routing: boolean;
  /** The routing server's origin; null whenever `routing` is false. */
  routingServer: string | null;
}

export interface MapPolicy {
  /** The environment's map server, whatever the setting says; null when it is `off`. */
  readonly mapServer: string | null;
  /** The environment's routing server; null when it is `off`. */
  readonly routingServer: string | null;
  readonly runtime: Env['ADMINIUM_RUNTIME'];
  /** `ADMINIUM_NETWORK_FEATURES`: off vetoes the routing server (a server-side call). */
  readonly networkFeatures: boolean;
  /** Where the two switches are read from. Until this is called, nobody has answered. */
  attach(settings: MapSettingsReader): void;
  read(): Promise<MapState>;
  /** The switches as stored, for Settings → Maps (`enabled` null = nobody answered). */
  stored(): Promise<{ enabled: boolean | null; routing: boolean }>;
  /** Forget the remembered setting: called by whoever writes it. */
  drop(): void;
}

export const MAPS_OFF: MapState = { enabled: false, server: null, routing: false, routingServer: null };

type MapEnv = Pick<Env, 'ADMINIUM_MAP_SERVER' | 'ADMINIUM_ROUTING_SERVER' | 'ADMINIUM_RUNTIME' | 'ADMINIUM_NETWORK_FEATURES'>;

export function createMapPolicy(env: MapEnv, now: () => number = Date.now): MapPolicy {
  const mapServer = env.ADMINIUM_MAP_SERVER === MAP_SERVER_OFF ? null : env.ADMINIUM_MAP_SERVER;
  const routingServer = env.ADMINIUM_ROUTING_SERVER === MAP_SERVER_OFF ? null : env.ADMINIUM_ROUTING_SERVER;
  // Decided without a read: the environment or the runtime already said no.
  const possible = mapServer !== null && env.ADMINIUM_RUNTIME !== 'desktop';
  let settings: MapSettingsReader | null = null;
  let held: { at: number; enabled: boolean | null; routing: boolean } | null = null;

  async function stored(): Promise<{ enabled: boolean | null; routing: boolean }> {
    if (settings === null) return { enabled: null, routing: false };
    const at = now();
    if (held !== null && at - held.at < MAP_SETTING_LIFE_MS) return held;
    const [enabled, routing] = await Promise.all([settings.get('maps.enabled'), settings.get('maps.routing')]);
    held = { at, enabled, routing };
    return held;
  }

  return {
    mapServer,
    routingServer,
    runtime: env.ADMINIUM_RUNTIME,
    networkFeatures: env.ADMINIUM_NETWORK_FEATURES,
    attach(reader) {
      settings = reader;
      held = null;
    },
    stored: async () => {
      const { enabled, routing } = await stored();
      return { enabled, routing };
    },
    async read() {
      if (!possible) return MAPS_OFF;
      const { enabled, routing } = await stored();
      if (enabled === false) return MAPS_OFF;
      const routed = routing && routingServer !== null && env.ADMINIUM_NETWORK_FEATURES;
      return { enabled: true, server: mapServer, routing: routed, routingServer: routed ? routingServer : null };
    },
    drop() {
      held = null;
    },
  };
}

/**
 * The policy with the map server's origin added to the two directives a map
 * needs: `connect-src` (the style, the tiles, the letters) and `img-src` (the
 * signs). Only a policy that already shows this server's own pages gains it: a
 * route with a policy of its own (a sandboxed document) is left alone.
 */
export function withMapServer(policy: string, origin: string): string {
  return policy
    .replace(/connect-src 'self'[^;]*/, (found) => `${found} ${origin}`)
    .replace(/img-src 'self'[^;]*/, (found) => `${found} ${origin}`);
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Whether maps are on and from where. Absent in a harness that does not register the core plugin. */
    maps: MapPolicy;
  }
}
