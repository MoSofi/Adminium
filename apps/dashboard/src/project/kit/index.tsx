// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project UI kit object the dashboard publishes as `ui` on the host
 * runtime global. Its names and shapes are `@adminiumjs/adminium/ui`'s
 * `ProjectUiKit`, checked here by the compiler, and its keys are
 * `PROJECT_UI_EXPORTS`, checked by `kit.test.tsx`.
 *
 * Loaded lazily by `../runtime.ts`: nothing here reaches the entry chunk.
 */

import type { ProjectUiKit } from '@adminium/server/ui';

import { DataTable, Stat } from './data.js';
import { EmptyState, Icon, toast } from './feedback.js';
import { mentionText } from '@adminium/widgets/mentions';
import { GeneratedPage } from './GeneratedPage.js';
import { Link, useCurrentUser, useMutation, useNavigate, useRecord, useRecords } from './hooks.js';
import { Button, Input, Select, Switch } from './inputs.js';
import { Card, Grid, Page, Stack } from './layout.js';
import { Board, ImportWizard, MapView, TextArea } from './parts.js';

export const projectUiKit: ProjectUiKit = Object.freeze({
  Page,
  Card,
  Stack,
  Grid,
  Button,
  Input,
  Select,
  Switch,
  TextArea,
  Board,
  ImportWizard,
  MapView,
  DataTable,
  Stat,
  GeneratedPage,
  toast,
  mentionText,
  EmptyState,
  Icon,
  useRecords,
  useRecord,
  useMutation,
  useCurrentUser,
  useNavigate,
  Link,
});
