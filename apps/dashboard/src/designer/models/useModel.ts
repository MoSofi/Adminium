// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model a new turn calls: the one the person picked here last, else the
 * one the server selects (`ADMINIUM_AI_MODEL`, or the saved setting). And
 * what is known about whether it can build.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { DESIGNER_EFFORTS, modelsQuery, type DesignerEffort, type DesignerModels } from '../api.js';

export interface PickedModel {
  connectionId: string;
  model: string;
  /** How hard the model is asked to work; absent at the model's own default. */
  effort?: DesignerEffort | undefined;
}

const KEY = 'adminium.designer.model';

function remembered(): PickedModel | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<PickedModel>;
    const effort = DESIGNER_EFFORTS.find((level) => level === parsed.effort);
    return typeof parsed.connectionId === 'string' && typeof parsed.model === 'string' ? { connectionId: parsed.connectionId, model: parsed.model, ...(effort === undefined ? {} : { effort }) } : null;
  } catch {
    return null;
  }
}

/** Whether a model is offered by a connection that is there. */
function offered(models: DesignerModels, picked: PickedModel | null): boolean {
  return picked !== null && models.connections.some((connection) => connection.id === picked.connectionId);
}

/**
 * `session`: the build page's model is the session's own; picking one changes the session
 * (`onPick`) and is not remembered for Home.
 */
export function useDesignerModel(session?: { picked: PickedModel; onPick: (next: PickedModel) => void }) {
  const models = useQuery(modelsQuery());
  const [mine, setMine] = useState<PickedModel | null>(() => (session === undefined ? remembered() : null));
  const data = models.data;
  const picked: PickedModel | null = session !== undefined ? session.picked : data === undefined ? null : offered(data, mine) ? mine : data.selected;
  const verdict = data === undefined || picked === null ? undefined : data.verdicts.find((entry) => entry.connectionId === picked.connectionId && entry.model === picked.model);

  /** The levels a model takes, as its connection lists them. */
  const effortsOf = useCallback(
    (of: { connectionId: string; model: string } | null): DesignerEffort[] =>
      of === null ? [] : (data?.connections.find((connection) => connection.id === of.connectionId)?.models.find((entry) => entry.id === of.model)?.efforts ?? []),
    [data],
  );
  const efforts = effortsOf(picked);
  // A level kept from another model, which this one does not take, is not shown and not sent.
  const effort = picked?.effort !== undefined && efforts.includes(picked.effort) ? picked.effort : null;

  const onSessionPick = session?.onPick;
  const pick = useCallback((chosen: PickedModel) => {
    // Another model keeps the level only when it takes it too.
    const kept = chosen.effort ?? effort ?? undefined;
    const next: PickedModel = { connectionId: chosen.connectionId, model: chosen.model, ...(kept !== undefined && effortsOf(chosen).includes(kept) ? { effort: kept } : {}) };
    if (onSessionPick !== undefined) {
      onSessionPick(next);
      return;
    }
    setMine(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // A private window: remembered for this page only.
    }
  }, [onSessionPick, effort, effortsOf]);

  const onSessionEffort = session?.onPick;
  /** `null`: the model's own default. */
  const pickEffort = useCallback((level: DesignerEffort | null) => {
    if (picked === null) return;
    const next: PickedModel = { connectionId: picked.connectionId, model: picked.model, ...(level === null ? {} : { effort: level }) };
    if (onSessionEffort !== undefined) {
      onSessionEffort(next);
      return;
    }
    setMine(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // A private window: remembered for this page only.
    }
  }, [picked, onSessionEffort]);

  // A remembered model whose connection went away is forgotten.
  useEffect(() => {
    if (data !== undefined && mine !== null && !offered(data, mine)) setMine(null);
  }, [data, mine]);

  return {
    loading: models.isPending,
    /** Some connection lists at least one model: there is something to pick. */
    hasModels: data?.connections.some((connection) => connection.models.length > 0) ?? false,
    models: data,
    /** Whether a model can be added from here. Not on a live server: its models are the server's own (Settings → AI). */
    canAdd: data?.canAdd ?? true,
    picked,
    /** `false`: it cannot build, with why. `true`: it can. `null`: not known yet. */
    canBuild: verdict === undefined ? null : verdict.canBuild,
    cannotBuildMessage: verdict?.canBuild === false ? verdict.message : null,
    pick,
    /** The effort levels the picked model takes, the least first: empty when it takes none, and no menu is shown. */
    efforts,
    /** The level picked, or `null` at the model's own default. */
    effort,
    pickEffort,
  };
}
