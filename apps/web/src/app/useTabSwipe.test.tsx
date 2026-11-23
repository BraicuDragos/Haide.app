import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTabSwipe } from './useTabSwipe';

const PATHS = ['/find', '/offer', '/rides', '/profile'];

function Surface() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const loc = useLocation();
  useTabSwipe(el, { paths: PATHS, index: PATHS.indexOf(loc.pathname), enabled: true });
  return (
    <div ref={setEl} data-testid="surface">
      <main>
        <p data-testid="where">{loc.pathname}</p>
        <button data-testid="plain">plain</button>
        <input data-testid="field" />
        <div data-no-swipe>
          <span data-testid="marked">marked</span>
        </div>
      </main>
    </div>
  );
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Surface />
    </MemoryRouter>,
  );
}

let t = 0;
function ptr(el: Element, type: string, x: number, y: number, id = 1) {
  t += 10;
  const e = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
  Object.assign(e, {
    pointerType: 'touch',
    pointerId: id,
    isPrimary: id === 1,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(e, 'timeStamp', { value: t });
  act(() => {
    el.dispatchEvent(e);
  });
}
function swipe(el: Element, x0: number, dx: number, dy = 0) {
  ptr(el, 'pointerdown', x0, 300);
  ptr(el, 'pointermove', x0 + dx / 2, 300 + dy / 2);
  ptr(el, 'pointermove', x0 + dx, 300 + dy);
  ptr(el, 'pointerup', x0 + dx, 300 + dy);
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });
  document.documentElement.dataset.motion = 'reduced';
});
afterEach(cleanup);

describe('useTabSwipe', () => {
  it('left goes to the next tab, right to the previous one', () => {
    const { getByTestId } = mount('/find');
    swipe(getByTestId('plain'), 200, -120);
    expect(getByTestId('where').textContent).toBe('/offer');
    swipe(getByTestId('plain'), 100, 120);
    expect(getByTestId('where').textContent).toBe('/find');
  });
  it('does nothing at the ends', () => {
    const { getByTestId } = mount('/find');
    swipe(getByTestId('plain'), 100, 150);
    expect(getByTestId('where').textContent).toBe('/find');
  });
  it('ignores a start in the outer 24 px', () => {
    const { getByTestId } = mount('/find');
    swipe(getByTestId('plain'), 10, -150);
    expect(getByTestId('where').textContent).toBe('/find');
    swipe(getByTestId('plain'), 345, -10);
    expect(getByTestId('where').textContent).toBe('/find');
  });
  it('ignores inputs and data-no-swipe areas', () => {
    const { getByTestId } = mount('/find');
    swipe(getByTestId('field'), 250, -150);
    swipe(getByTestId('marked'), 250, -150);
    expect(getByTestId('where').textContent).toBe('/find');
  });
  it('ignores a mostly vertical move and a second finger', () => {
    const { getByTestId } = mount('/find');
    swipe(getByTestId('plain'), 250, -80, 120);
    expect(getByTestId('where').textContent).toBe('/find');
    const el = getByTestId('plain');
    ptr(el, 'pointerdown', 250, 300);
    ptr(el, 'pointerdown', 100, 300, 2);
    ptr(el, 'pointermove', 100, 300);
    ptr(el, 'pointerup', 100, 300);
    expect(getByTestId('where').textContent).toBe('/find');
  });
  it('ignores a swipe while a dialog is open', () => {
    const { getByTestId } = mount('/find');
    const d = document.createElement('dialog');
    d.setAttribute('open', '');
    document.body.appendChild(d);
    swipe(getByTestId('plain'), 250, -150);
    d.remove();
    expect(getByTestId('where').textContent).toBe('/find');
  });
});
