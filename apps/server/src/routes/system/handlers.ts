/** Handlers for the system resource (08-server-api.md §1.2 route-module layout). */
import { APP_VERSION } from '../../version.js';
import type { SystemHealthzReply, SystemInfoReply } from './schema.js';

/** Liveness: the process is up and serving (no dependency checks). */
export function healthz(): SystemHealthzReply {
  return { ok: true, version: APP_VERSION, uptime: process.uptime() };
}

/** Build/runtime info. `dialect` stays null until meta wiring lands (wave 2). */
export function systemInfo(): SystemInfoReply {
  return { version: APP_VERSION, node: process.version, dialect: null };
}
