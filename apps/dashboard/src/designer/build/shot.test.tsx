// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { areaBetween, shotFrom } from './shot.js';
import { ShotOverlay } from './ShotOverlay.js';

afterEach(cleanup);

describe('the part of the preview dragged over', () => {
  it('is the box two points span, whichever way the drag went, held inside the frame', () => {
    expect(areaBetween({ x: 10.4, y: 20 }, { x: 310, y: 220.6 }, 800, 600)).toEqual({ left: 10, top: 20, width: 300, height: 201 });
    expect(areaBetween({ x: 310, y: 220 }, { x: 10, y: 20 }, 800, 600)).toEqual({ left: 10, top: 20, width: 300, height: 200 });
    expect(areaBetween({ x: 700, y: 500 }, { x: 900, y: -40 }, 800, 600)).toEqual({ left: 700, top: 0, width: 100, height: 500 });
  });

  it('is nothing when the drag is a slip of the hand', () => {
    expect(areaBetween({ x: 10, y: 10 }, { x: 14, y: 300 }, 800, 600)).toBeNull();
    expect(areaBetween({ x: 10, y: 10 }, { x: 10, y: 10 }, 800, 600)).toBeNull();
  });
});

describe('what a screen says of a picture asked of it', () => {
  const jpeg = `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 9))}`;
  const said = (over: Record<string, unknown> = {}) => ({ type: 'adminium:side-shot', app: 'shop', side: 'customer', id: 3, picture: jpeg, ...over });

  it('is a file when it answers this asking with a JPEG', () => {
    const file = shotFrom(said(), 'shop', 'customer', 3);
    expect(file).toBeInstanceOf(File);
    expect((file as File).type).toBe('image/jpeg');
  });

  it('is no answer for another app, side, number or kind of message', () => {
    expect(shotFrom(said({ app: 'other' }), 'shop', 'customer', 3)).toBeNull();
    expect(shotFrom(said(), 'shop', 'staff', 3)).toBeNull();
    expect(shotFrom(said({ id: 4 }), 'shop', 'customer', 3)).toBeNull();
    expect(shotFrom(said({ type: 'adminium:side-sight' }), 'shop', 'customer', 3)).toBeNull();
    expect(shotFrom(null, 'shop', 'customer', 3)).toBeNull();
  });

  it('is an answer with no picture when none came, or what came is no JPEG, or is too large', () => {
    expect(shotFrom(said({ picture: undefined }), 'shop', 'customer', 3)).toBe(false);
    expect(shotFrom(said({ picture: 'data:image/png;base64,AAAA' }), 'shop', 'customer', 3)).toBe(false);
    expect(shotFrom(said({ picture: `data:image/jpeg;base64,${btoa('<svg>')}` }), 'shop', 'customer', 3)).toBe(false);
    expect(shotFrom(said({ picture: 'data:image/jpeg;base64,***' }), 'shop', 'customer', 3)).toBe(false);
    expect(shotFrom(said({ picture: `data:image/jpeg;base64,${'A'.repeat(2_600_000)}` }), 'shop', 'customer', 3)).toBe(false);
  });
});

describe('the layer a picture is dragged on', () => {
  const layer = (drawing = false) => {
    const onArea = vi.fn();
    render(<ShotOverlay drawing={drawing} onArea={onArea} />);
    const el = screen.getByRole('img', { name: 'Drag over the part of the page to take a picture of' });
    el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50, toJSON: () => ({}) });
    return { el, onArea };
  };

  it('draws the box as it is dragged and says it, in the frame’s own pixels, when the pointer is let go', () => {
    const { el, onArea } = layer();
    fireEvent.pointerDown(el, { button: 0, clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 450, clientY: 300, pointerId: 1 });
    const box = el.querySelector<HTMLElement>('[data-part="shot-box"]');
    expect(['--shot-left', '--shot-top', '--shot-width', '--shot-height'].map((name) => box?.style.getPropertyValue(name))).toEqual(['50px', '50px', '300px', '200px']);
    expect(onArea).not.toHaveBeenCalled();
    fireEvent.pointerUp(el, { clientX: 450, clientY: 300, pointerId: 1 });
    expect(onArea).toHaveBeenCalledWith({ left: 50, top: 50, width: 300, height: 200 });
  });

  it('takes nothing for a click, and nothing more while a picture is being drawn', () => {
    const { el, onArea } = layer();
    fireEvent.pointerDown(el, { button: 0, clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 152, clientY: 101, pointerId: 1 });
    expect(onArea).not.toHaveBeenCalled();
    cleanup();

    const busy = layer(true);
    expect(screen.getByRole('status').textContent).toBe('Taking the picture…');
    fireEvent.pointerDown(busy.el, { button: 0, clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(busy.el, { clientX: 450, clientY: 300, pointerId: 1 });
    expect(busy.onArea).not.toHaveBeenCalled();
  });
});
