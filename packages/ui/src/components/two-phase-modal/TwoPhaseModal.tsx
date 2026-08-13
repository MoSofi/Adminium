import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Modal, type ModalProps } from '../modal/Modal.js';
import { SuccessState, type SuccessStateProps } from '../success-state/SuccessState.js';

export type ModalPhase = 'form' | 'success';

export interface ModalFlow<T> {
  /** Current phase. */
  phase: ModalPhase;
  /** Harvested form payload, set by `toSuccess` (null during the form phase). */
  payload: T | null;
  /** Swap to the success phase, harvesting the submitted inputs. */
  toSuccess: (payload: T) => void;
  /** Return to a fresh form phase (called automatically after close). */
  reset: () => void;
}

/**
 * useModalFlow — state machine for the canonical two-phase (form → success)
 * modal (03-component-library.md §7.1, research/ia-mapping.md §5.3).
 */
export function useModalFlow<T>(): ModalFlow<T> {
  const [state, setState] = useState<{ phase: ModalPhase; payload: T | null }>({
    phase: 'form',
    payload: null,
  });
  const toSuccess = useCallback((payload: T) => {
    setState({ phase: 'success', payload });
  }, []);
  const reset = useCallback(() => {
    setState({ phase: 'form', payload: null });
  }, []);
  return { phase: state.phase, payload: state.payload, toSuccess, reset };
}

/** Modal exit animation length — `flow.reset()` is deferred past it (§7.1). */
export const MODAL_EXIT_MS = 240;

export interface TwoPhaseModalProps<T> extends Omit<ModalProps, 'children'> {
  /** The flow from `useModalFlow<T>()`; drives which phase renders. */
  flow: ModalFlow<T>;
  /** Phase-1 form content (ModalHeader/ModalBody/ModalFooter composition). */
  children: ReactNode;
  /** Success heading; receives the harvested payload. */
  successTitle: ReactNode | ((payload: T) => ReactNode);
  /** Success copy — echo harvested inputs ("We emailed {payload.email}"). */
  successBody?: ReactNode | ((payload: T) => ReactNode) | undefined;
  /** Done button label (required — i18n). */
  doneLabel: string;
  /** Extra props forwarded to the phase-2 `SuccessState`. */
  successProps?: Partial<Omit<SuccessStateProps, 'title' | 'body' | 'doneLabel' | 'onDone'>> | undefined;
}

function resolve<T>(value: ReactNode | ((payload: T) => ReactNode), payload: T): ReactNode {
  return typeof value === 'function' ? value(payload) : value;
}

/**
 * TwoPhaseModal — the canonical form → success modal: the same Radix Dialog
 * instance swaps its body to a `SuccessState` on `flow.toSuccess(payload)`,
 * preserving focus; harvested inputs echo into the success copy; Done and
 * Esc/backdrop close, and `flow.reset()` runs after the exit animation so the
 * success phase never flashes back to the form while closing
 * (03-component-library.md §7.1).
 */
export function TwoPhaseModal<T>({
  flow,
  children,
  successTitle,
  successBody,
  doneLabel,
  successProps,
  onOpenChange,
  ...modalProps
}: TwoPhaseModalProps<T>) {
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unmounting before the deferred reset fires would otherwise leave the timer
  // to call `flow.reset()` against a dead component (a setState-after-unmount
  // in the app; in tests, a callback that can outlive the environment teardown).
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleOpenChange = (open: boolean) => {
    onOpenChange?.(open);
    if (!open) {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        flow.reset();
        resetTimer.current = null;
      }, MODAL_EXIT_MS);
    }
  };

  return (
    <Modal {...modalProps} onOpenChange={handleOpenChange}>
      {flow.phase === 'form' || flow.payload === null ? (
        children
      ) : (
        <SuccessState
          {...successProps}
          title={resolve(successTitle, flow.payload)}
          body={successBody === undefined ? undefined : resolve(successBody, flow.payload)}
          doneLabel={doneLabel}
          onDone={() => handleOpenChange(false)}
        />
      )}
    </Modal>
  );
}
