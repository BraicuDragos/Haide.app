import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DayPicker } from './DayPicker';
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
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motion;
  vi.unstubAllGlobals();
});

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

const hours = () => screen.getByRole('listbox', { name: 'Hours' });
const mins = () => screen.getByRole('listbox', { name: 'Minutes' });
const field = () => screen.getByRole('button', { name: /^Leave around/ });
const opt = (box: HTMLElement, name: string) => within(box).getByRole('option', { name });
const selected = (box: HTMLElement) =>
  within(box)
    .getAllByRole('option')
    .find((o) => o.getAttribute('aria-selected') === 'true')?.textContent;
const type = (box: HTMLElement, text: string) =>
  [...text].forEach((key) => fireEvent.keyDown(box, { key }));
const set = () => fireEvent.click(screen.getByRole('button', { name: 'Set time' }));

async function open() {
  fireEvent.click(field());
  await act(async () => {}); // the wheels position themselves in a microtask once the dialog is open
}

describe('TimePicker', () => {
  it('shows the placeholder, then opens a sheet with an hour wheel and a 5 minute wheel', async () => {
    render(<Harness />);
    expect(field().textContent).toContain('Choose');
    expect(field().getAttribute('aria-haspopup')).toBe('dialog');
    await open();
    expect(within(hours()).getAllByRole('option')).toHaveLength(24);
    expect(
      within(mins())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']);
  });

  it('opens on 08:00 when nothing is chosen, and the hour wheel gets focus', async () => {
    render(<Harness />);
    await open();
    expect(selected(hours())).toBe('08');
    expect(selected(mins())).toBe('00');
    expect(document.activeElement).toBe(hours());
  });

  it('types 07 and 35 (type-ahead) and returns HH:MM', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await open();
    type(hours(), '07');
    type(mins(), '35');
    expect(selected(hours())).toBe('07');
    expect(selected(mins())).toBe('35');
    set();
    expect(spy).toHaveBeenCalledWith('07:35');
    expect(field().textContent).toContain('07:35');
  });

  it('moves with the arrows, PageUp/PageDown (5), Home and End, and keeps the active option in aria-activedescendant', async () => {
    render(<Harness initial="10:00" />);
    await open();
    fireEvent.keyDown(hours(), { key: 'ArrowDown' });
    expect(selected(hours())).toBe('11');
    fireEvent.keyDown(hours(), { key: 'ArrowUp' });
    fireEvent.keyDown(hours(), { key: 'ArrowUp' });
    expect(selected(hours())).toBe('09');
    fireEvent.keyDown(hours(), { key: 'PageDown' });
    expect(selected(hours())).toBe('14');
    fireEvent.keyDown(hours(), { key: 'PageUp' });
    expect(selected(hours())).toBe('09');
    fireEvent.keyDown(hours(), { key: 'End' });
    expect(selected(hours())).toBe('23');
    fireEvent.keyDown(hours(), { key: 'ArrowDown' }); // no wrap
    expect(selected(hours())).toBe('23');
    fireEvent.keyDown(hours(), { key: 'Home' });
    expect(selected(hours())).toBe('00');
    expect(hours().getAttribute('aria-activedescendant')).toBe(opt(hours(), '00').id);
  });

  it('a tap on a row selects it', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await open();
    fireEvent.click(opt(hours(), '18'));
    fireEvent.click(opt(mins(), '45'));
    set();
    expect(spy).toHaveBeenCalledWith('18:45');
  });

  it('Enter on a wheel confirms', async () => {
    const spy = vi.fn();
    render(<Harness initial="06:10" spy={spy} />);
    await open();
    fireEvent.keyDown(hours(), { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith('06:10');
  });

  it('Cancel leaves the value unchanged', async () => {
    const spy = vi.fn();
    render(<Harness initial="08:15" spy={spy} />);
    await open();
    fireEvent.click(opt(hours(), '09'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(spy).not.toHaveBeenCalled();
    expect(field().textContent).toContain('08:15');
  });

  it('dims slots before minTime, never selects them, and moves the minute forward', async () => {
    const spy = vi.fn();
    render(<Harness initial="12:00" minTime="09:20" spy={spy} />);
    await open();
    expect(opt(hours(), '08').getAttribute('aria-disabled')).toBe('true');
    expect(opt(hours(), '09').getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(opt(hours(), '08')); // disabled: ignored
    expect(selected(hours())).toBe('12');
    fireEvent.keyDown(hours(), { key: 'Home' }); // first enabled hour
    expect(selected(hours())).toBe('09');
    expect(opt(mins(), '15').getAttribute('aria-disabled')).toBe('true');
    expect(selected(mins())).toBe('20'); // minute 00 is too early at 09, it moved to the first allowed one
    set();
    expect(spy).toHaveBeenCalledWith('09:20');
  });

  it('opens on minTime when nothing is chosen, and when the saved value is already too early', async () => {
    const { unmount } = render(<Harness minTime="21:35" />);
    await open();
    expect(selected(hours())).toBe('21');
    expect(selected(mins())).toBe('35');
    unmount();
    render(<Harness initial="07:30" minTime="21:35" />);
    await open();
    expect(selected(hours())).toBe('21');
    expect(selected(mins())).toBe('35');
  });

  it('keeps an off-grid value: the wheel rests on the nearest slot but confirming returns the original', async () => {
    const spy = vi.fn();
    render(<Harness initial="07:32" spy={spy} />);
    await open();
    expect(selected(mins())).toBe('30');
    set();
    expect(spy).toHaveBeenCalledWith('07:32');
  });

  it('an off-grid value becomes a grid value once the user moves the minute wheel', async () => {
    const spy = vi.fn();
    render(<Harness initial="07:32" spy={spy} />);
    await open();
    fireEvent.keyDown(mins(), { key: 'ArrowDown' });
    set();
    expect(spy).toHaveBeenCalledWith('07:35');
  });

  it('disables everything and "Set" when the day is over (24:00)', async () => {
    render(<Harness minTime="24:00" />);
    await open();
    expect(
      within(hours())
        .getAllByRole('option')
        .every((o) => o.getAttribute('aria-disabled') === 'true'),
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Set time' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('announces the chosen value in a polite live region', async () => {
    render(<Harness initial="08:15" />);
    await open();
    const live = screen.getByRole('status');
    expect(live.textContent).toBe('08:15');
    fireEvent.keyDown(hours(), { key: 'ArrowDown' });
    expect(live.textContent).toBe('09:15');
  });

  it('ticks on a change where haptics exist, and stays silent with reduced motion', async () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate });
    render(<Harness initial="08:00" />);
    await open();
    fireEvent.click(opt(hours(), '10'));
    expect(vibrate).toHaveBeenCalledWith(5);
    vibrate.mockClear();
    document.documentElement.dataset.motion = 'reduced';
    fireEvent.click(opt(hours(), '12'));
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('DayPicker', () => {
  const options = [
    { value: '2026-11-23', label: 'Today' },
    { value: '2026-11-24', label: 'Tomorrow' },
    { value: '2026-11-25', label: 'Wed 25 Nov' },
  ];
  function Day(props: { initial?: string; spy?: (v: string) => void }) {
    const [v, setV] = useState(props.initial ?? '2026-11-23');
    return (
      <DayPicker
        id="d"
        label="Day"
        value={v}
        options={options}
        onChange={(x) => {
          setV(x);
          props.spy?.(x);
        }}
      />
    );
  }
  const trigger = () => screen.getByRole('button', { name: /^Day/ });
  const wheel = () => screen.getByRole('listbox', { name: 'Day' });

  it('shows the label of the value and returns YYYY-MM-DD from the wheel', async () => {
    const spy = vi.fn();
    render(<Day spy={spy} />);
    expect(trigger().textContent).toContain('Today');
    fireEvent.click(trigger());
    await act(async () => {});
    expect(within(wheel()).getAllByRole('option')).toHaveLength(3);
    fireEvent.keyDown(wheel(), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('button', { name: 'Set day' }));
    expect(spy).toHaveBeenCalledWith('2026-11-24');
    expect(trigger().textContent).toContain('Tomorrow');
  });

  it('type-ahead picks Wed, tap picks Tomorrow, Cancel keeps the day', async () => {
    const spy = vi.fn();
    render(<Day spy={spy} />);
    fireEvent.click(trigger());
    await act(async () => {});
    type(wheel(), 'wed');
    expect(selected(wheel())).toBe('Wed 25 Nov');
    fireEvent.click(opt(wheel(), 'Tomorrow'));
    expect(selected(wheel())).toBe('Tomorrow');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(spy).not.toHaveBeenCalled();
    expect(trigger().textContent).toContain('Today');
  });
});
