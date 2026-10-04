// SPDX-License-Identifier: AGPL-3.0-only
/** Types for the parts of `fake-llm.mjs` the specs import. */
import type { Server } from 'node:http';

export function createFakeLlmServer(): Server;

/** A scripted model for Adminium Designer, in Ollama's streaming protocol. */
export function createDesignerModelServer(options: { appKey: string; appName?: string; files: Record<string, string> }): Server;
