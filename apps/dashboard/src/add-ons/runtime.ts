// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Publishing the host API to add-on page bundles (51c).
 *
 * The same contract `project/runtime.ts` installs for a project's own pages,
 * with `host` added: React, the JSX runtime and react-dom so a bundle renders
 * with ONE reconciler, plus the four namespaces an add-on page imports by their
 * real names (`@adminium/ui`, the router, react-query, `@adminium/i18n`).
 *
 * ORDER IS THE WHOLE CONTRACT: the shims read the global as their module
 * initialises, so this must resolve BEFORE the first `import()` of a bundle.
 * `loadAddOnModule` awaits it for exactly that reason, and the error a bundle
 * throws when it is skipped names this function rather than failing later
 * inside a hook.
 *
 * WHY EVERY NAME IS IMPORTED EXPLICITLY, AND NEVER `import * as ui`.
 *
 * The namespace form was written first and it cost 2.6 KiB gz IN THE ENTRY
 * CHUNK — which is not where this module even lives. Pulling the whole kit into
 * this (lazy) chunk widened what it shares with the other lazy chunks, and
 * Rollup answered by hoisting the page-builder's modules into the entry. The
 * budget gate caught it; the source map named it, after the first guess was
 * wrong. Attribute an entry-size change through the map before believing any
 * story about it.
 *
 * Explicit names are also the more honest shape: the host publishes exactly
 * `ADD_ON_UI_EXPORTS` and friends, and `addOnRuntime.test.ts` asserts the
 * objects below have exactly those keys — so the published surface cannot drift
 * from the lists that define it.
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useBlocker, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AutosaveIndicator,
  Badge,
  Button,
  EmptyState,
  IconButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  SegmentedControl,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tag,
  cn,
} from '@adminium/ui';
import { tagForLocale } from '@adminium/i18n';

import { ApiError, api } from '../app/api.js';
import { bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { lucideByName } from '../lib/lucide.js';
import { useAppToasts } from '../pages/toasts.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { useShortcut } from '../shell/ShortcutsProvider.js';
import { formatSince } from '../team/teamApi.js';
import {
  HOST_API_VERSION,
  installAddOnRuntime,
  type AddOnAppNamespace,
} from '@adminium/add-on-contracts/runtime';

let installing: Promise<void> | null = null;

export function ensureAddOnRuntime(): Promise<void> {
  installing ??= Promise.resolve().then(() => {
    installAddOnRuntime({
      react: React as unknown as Readonly<Record<string, unknown>>,
      jsx: { jsx, jsxs, Fragment },
      reactDom: ReactDOM as unknown as Readonly<Record<string, unknown>>,
      host: {
        version: HOST_API_VERSION,
        ui: { Alert, AutosaveIndicator, Badge, Button, EmptyState, IconButton, Modal, ModalBody, ModalFooter, ModalHeader, Popover, PopoverContent, PopoverTrigger, SearchInput, SegmentedControl, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Tag, cn },
        router: { useBlocker, useNavigate, useParams, useSearch },
        query: { QueryClient, queryOptions, useMutation, useQuery, useQueryClient },
        i18n: { tagForLocale },
        /*
         * The host itself (O7). These eleven are why an add-on page can BE a
         * dashboard page rather than an iframe with a border: it renders into
         * the shell's own chrome, translates through the running catalogue,
         * and calls the API with the session's CSRF token.
         */
        /*
         * `satisfies` is the proof, and it belongs here rather than in a test:
         * the contract declares what an add-on page may call, and this is the
         * one place that can show the running dashboard actually provides it.
         * A signature that drifts fails THIS build, not an add-on's build in
         * another repository after a release.
         */
        app: {
          ApiError,
          PageActions,
          PageSurface,
          api,
          bootstrapQuery,
          formatSince,
          lucideByName,
          t,
          useAppToasts,
          useShortcut,
        } satisfies AddOnAppNamespace,
      },
    });
  });
  return installing;
}

/** Test seam. */
export function resetAddOnRuntime(): void {
  installing = null;
}
