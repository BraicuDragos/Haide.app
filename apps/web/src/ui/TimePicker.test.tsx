import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { minTimeFor, toMinutes } from '@/lib/timeSlots';
import { TimePicker } from './TimePicker';

beforeAll(() => {
  // jsdom has no modal dialog support
  const proto = HTMLDialogElement.prototype;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(cleanup);

function Harness(props: { initial?: string; minTime?: string; spy?: (v: string) => void }) {
  const [v, setV] = useState(props.initial ?? '');
  return (
    <TimePicker
      id="t"
      label="Leave around"
      value={v}
      minTime={props.minTime}
      onChange={(x) => {
        setV(x);
        props.spy?.(x);
      }}
    />
  );
}

const hours = () => screen.getByRole('radiogroup', { name: 'Hour' });
const mins = () => screen.getByRole('radiogroup', { name: 'Minute' });
const open = () => fireEvent.click(screen.getByRole('button', { name: /Leave around/ }));

describe('TimePicker', () => {
  it('shows the placeholder, then opens the sheet', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /Leave around/ }).textContent).toContain('Choose');
    open();
    expect(within(hours()).getAllByRole('radio')).toHaveLength(24);
    expect(within(mins()).getAllByRole('radio')).toHaveLength(12);
  });

  it('selects an hour and a minute and returns HH:MM', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    open();
    fireEvent.click(within(hours()).getByRole('radio', { name: '07' }));
    fireEvent.click(within(mins()).getByRole('radio', { name: '30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set time' }));
    expect(spy).toHaveBeenCalledWith('07:30');
    expect(screen.getByRole('button', { name: /Leave around/ }).textContent).toContain('07:30');
  });

  it('starts at :00 when only an hour is chosen, and keeps the 5 minute step', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    open();
    fireEvent.click(within(hours()).getByRole('radio', { name: '18' }));
    const labels = within(mins())
      .getAllByRole('radio')
      .map((r) => r.textContent);
    fireEvent.click(screen.getByRole('button', { name: 'Set time' }));
    expect(spy).toHaveBeenCalledWith('18:00');
    expect(labels).toEqual([
      '00',
      '05',
      '10',
      '15',
      '20',
      '25',
      '30',
      '35',
      '40',
      '45',
      '50',
      '55',
    ]);
  });

  it('cancel leaves the value unchanged', () => {
    const spy = vi.fn();
    render(<Harness initial="08:15" spy={spy} />);
    open();
    fireEvent.click(within(hours()).getByRole('radio', { name: '09' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Leave around/ }).textContent).toContain('08:15');
  });

  it('disables slots before minTime and moves the minute forward', () => {
    const spy = vi.fn();
    render(<Harness initial="12:00" minTime="09:20" spy={spy} />);
    open();
    const h = (n: string) => within(hours()).getByRole('radio', { name: n }) as HTMLButtonElement;
    expect(h('08').disabled).toBe(true);
    expect(h('09').disabled).toBe(false);
    fireEvent.click(h('09'));
    const m = (n: string) => within(mins()).getByRole('radio', { name: n }) as HTMLButtonElement;
    expect(m('15').disabled).toBe(true);
    expect(m('20').disabled).toBe(false);
    // minute 00 is not allowed at 09, so it moved to the first allowed one
    expect(m('20').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Set time' }));
    expect(spy).toHaveBeenCalledWith('09:20');
  });

  it('disables everything when the day is over (24:00)', () => {
    render(<Harness minTime="24:00" />);
    open();
    expect(
      within(hours())
        .getAllByRole('radio')
        .every((r) => (r as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it('moves with the arrow keys inside a group and skips disabled items', () => {
    render(<Harness initial="10:00" minTime="09:00" />);
    open();
    const ten = within(hours()).getByRole('radio', { name: '10' });
    ten.focus();
    fireEvent.keyDown(hours(), { key: 'ArrowRight' });
    expect(within(hours()).getByRole('radio', { name: '11' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.keyDown(hours(), { key: 'ArrowDown' });
    expect(within(hours()).getByRole('radio', { name: '17' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.keyDown(hours(), { key: 'Home' });
    expect(within(hours()).getByRole('radio', { name: '09' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.keyDown(hours(), { key: 'ArrowLeft' });
    expect(within(hours()).getByRole('radio', { name: '09' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('wires the error to the button', () => {
    render(
      <TimePicker
        id="t"
        label="Leave around"
        value=""
        onChange={() => {}}
        error="Choose a time."
      />,
    );
    const b = screen.getByRole('button', { name: /Leave around/ });
    expect(b.getAttribute('aria-invalid')).toBe('true');
    expect(b.getAttribute('aria-describedby')).toBe('t-err');
    expect(screen.getByRole('alert').textContent).toContain('Choose a time.');
  });
});

describe('minTimeFor', () => {
  // 2026-11-16 08:07 in Bucharest (UTC+2) = 06:07Z
  const now = new Date('2026-11-16T06:07:00Z');
  it('rounds now plus lead up to the step on the same day', () => {
    expect(minTimeFor('2026-11-16', 0, 5, now)).toBe('08:10');
    expect(minTimeFor('2026-11-16', 15 * 60_000, 5, now)).toBe('08:25');
  });
  it('is open for later days and closed when the lead crosses midnight', () => {
    expect(minTimeFor('2026-11-17', 15 * 60_000, 5, now)).toBeUndefined();
    const late = new Date('2026-11-16T21:50:00Z'); // 23:50 local
    expect(minTimeFor('2026-11-16', 15 * 60_000, 5, late)).toBe('24:00');
    expect(toMinutes('24:00')).toBe(1440);
  });
});
