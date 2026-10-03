// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model a new turn calls: the one the person picked here last, else the
 * one the server selects (`ADMINIUM_AI_MODEL`, or the saved setting). And
 * what is known about whether it can build.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { modelsQuery, type DesignerModels } from '../api.js';

export interface PickedModel {
  connectionId: string;
  model: string;
}

const KEY = 'adminium.designer.model';

function remembered(): PickedModel | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<PickedModel>;
    return typeof parsed.connectionId === 'string' && typeof parsed.model === 'string' ? { connectionId: parsed.connectionId, model: parsed.model } : null;
  } catch {
    return null;
  }
}

/** Whether a model is offered by a connection that is there. */
function offered(models: DesignerModels, picked: PickedModel | null): boolean {
  return picked !== null && models.connections.some((connection) => connection.id === picked.connectionId);
}

export function useDesignerModel() {
  const models = useQuery(modelsQuery());
  const [mine, setMine] = useState<PickedModel | null>(() => remembered());
  const data = models.data;
  const picked: PickedModel | null = data === undefined ? null : offered(data, mine) ? mine : data.selected;
  const verdict = data === undefined || picked === null ? undefined : data.verdicts.find((entry) => entry.connectionId === picked.connectionId && entry.model === picked.model);

  const pick = useCallback((next: PickedModel) => {
    setMine(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // A private window: remembered for this page only.
    }
  }, []);

  // A remembered model whose connection went away is forgotten.
  useEffect(() => {
    if (data !== undefined && mine !== null && !offered(data, mine)) setMine(null);
  }, [data, mine]);

  return {
    loading: models.isPending,
    models: data,
    picked,
    /** `false`: it cannot build, with why. `true`: it can. `null`: not known yet. */
    canBuild: verdict === undefined ? null : verdict.canBuild,
    cannotBuildMessage: verdict?.canBuild === false ? verdict.message : null,
    pick,
  };
}
