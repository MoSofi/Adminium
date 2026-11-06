// SPDX-License-Identifier: AGPL-3.0-only
/** The gates' inputs, what they need, and what they answer (see `index.ts`). */
import type { AppManifest } from '@adminium/manifest';

import type { CheckItem } from '../check.js';
import type { SaveChoices, SaveSource } from '../types.js';

export interface GateInput {
  manifest: AppManifest;
  files: ReadonlyMap<string, Uint8Array>;
  source: SaveSource;
  choices: SaveChoices;
}

export interface GateDeps {
  /** `ADMINIUM_SECRET`: every sealed value on this server is opened with a key derived from it. */
  masterSecret: string;
  /** The project's `.env` file, on a project deployment. */
  projectEnvFile?: string | null;
}

export interface GateProblem {
  code: 'MANIFEST_INVALID' | 'PLAN_REFUSED' | 'INSTANCE_ID_LEFT';
  message: string;
  /** Where: a manifest path (`pages[2].envelope.config.layout`) or a package file. */
  path?: string;
}

export interface GateResult {
  /** `choice` items the person answers (secret hits, warnings); answered ones are not here. */
  choices: CheckItem[];
  /** Hard refusals: the save cannot be written. */
  problems: GateProblem[];
}
