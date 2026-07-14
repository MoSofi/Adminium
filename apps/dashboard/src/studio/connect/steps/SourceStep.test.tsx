/**
 * SourceStep (M9-T04) focused regression: in schema-file mode the format Select
 * must be disabled while a parse is in flight — same as the Dropzone — so a
 * format change cannot fire a second /schema-import/parse whose stale response
 * could clobber the newer one's preview/captured tables.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures.js';
import { INITIAL_WIZARD_STATE, type WizardState } from '../wizardState.js';
import { SourceStep } from './SourceStep.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function Harness() {
  const [state, setState] = useState<WizardState>({ ...INITIAL_WIZARD_STATE, mode: 'file', name: 'seed' });
  return <SourceStep state={state} onPatch={(patch) => setState((prev) => ({ ...prev, ...patch }))} />;
}

const uploadInput = () =>
  screen.getByText(/Drop your schema file here/).closest('button')!.nextElementSibling as HTMLInputElement;

it('disables the format Select while a parse is in flight', async () => {
  let resolveParse: ((res: Response) => void) | undefined;
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    if (String(input).includes('/schema-import/parse')) {
      return new Promise<Response>((resolve) => {
        resolveParse = resolve;
      });
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no mock' } }));
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<Harness />);
  const format = screen.getByLabelText('Schema format') as HTMLSelectElement;
  expect(format.disabled).toBe(false);

  const file = new File(['model User { id Int @id }'], 'schema.prisma', { type: 'text/plain' });
  await userEvent.upload(uploadInput(), file);

  // Parse pending → both the Dropzone and the format Select are locked, so the
  // user cannot kick off a competing parse against the same upload.
  await waitFor(() => expect(format.disabled).toBe(true));
  expect(screen.getByText(/Reading uploaded schema file/)).toBeDefined();

  resolveParse?.(
    jsonResponse(200, {
      model: { tables: [] },
      format: 'prisma',
      warnings: [],
      summary: { tables: 0, columns: 0, relations: 0, enums: 0 },
    }),
  );
  await waitFor(() => expect(format.disabled).toBe(false));
});
