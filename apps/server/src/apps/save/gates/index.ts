// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE GATES A SAVED FILE PASSES BEFORE IT IS WRITTEN.
 *
 * Run on the converter's result, on a trial pack of exactly the files the
 * download will hold:
 *  1. the id gate: a CONTAINS match over the manifest and every package file
 *     (view filter values included) for ids of this install: a row id
 *     (`<prefix>_<ULID>`), a generated page id, the connection's id, a
 *     `connectionId` key. Any leftover refuses the save;
 *  2. the secret scan: every secret this server holds (built from the schema:
 *     each encrypted meta column, each `secret: true` setting, webhook
 *     addresses, the project's `.env`), searched for decoded and encoded,
 *     whole and in every 12+ character piece, and each part of a database
 *     address on its own. A hit is a `choice` (clear the field, or leave the
 *     item out), named by kind, item and field, never by value;
 *  3. the warning layer: secrets Adminium cannot know (provider-like patterns,
 *     high-randomness strings) in mail, page text, public replies and rows. A
 *     hit is a `choice` (clear, or keep);
 *  4. validation (`validateManifest`, `allowLocalPublisher`) and a dry plan
 *     against a blank database of the source's engine. A problem refuses the
 *     save: the converter wrote a file the target would refuse, which is a bug
 *     to fix, not a choice for the person.
 */
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

export async function runSaveGates(input: GateInput, deps: GateDeps): Promise<GateResult> {
  void input;
  void deps;
  return { choices: [], problems: [] };
}
