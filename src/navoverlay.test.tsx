// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NavOverlay } from './components/NavOverlay';
import type { RouteStep } from './types';

afterEach(cleanup);

const step = (over: Partial<RouteStep> = {}): RouteStep => ({
  instruction: 'Turn right onto Main Street',
  street: 'Main Street',
  distanceM: 200,
  durationS: 20,
  type: 'turn',
  modifier: 'right',
  location: [8.68, 50.11],
  ...over,
});

const renderOverlay = (over: Partial<Parameters<typeof NavOverlay>[0]> = {}) =>
  render(
    <NavOverlay
      step={step()}
      distToNextM={180}
      remainingM={4200}
      remainingS={600}
      speedKmh={52}
      progress={0.3}
      mode="car"
      onStop={() => {}}
      {...over}
    />,
  );

describe('navigation card', () => {
  it('shows the distance to the turn, the street and the ETA', () => {
    const { container } = renderOverlay();
    const text = container.textContent ?? '';
    expect(text).toContain('180 m');
    expect(text).toContain('Turn right');
    expect(text).toContain('Main Street');
    expect(text).toContain('10 min');
    expect(text).toContain('52 km/h');
    expect(text).toContain('Stop');
  });

  it('draws a lane diagram, lighting only the lanes that keep the route', () => {
    const { container } = renderOverlay({
      step: step({
        lanes: [
          { directions: ['left'], active: false },
          { directions: ['straight', 'right'], active: true },
        ],
      }),
    });
    const lanes = container.querySelectorAll('.nav-lanes .lane');
    expect(lanes).toHaveLength(2);
    expect(lanes[0].classList.contains('on')).toBe(false);
    expect(lanes[1].classList.contains('on')).toBe(true);
    expect(lanes[1].textContent).toBe('↑→');
  });

  it('labels a motorway exit and shows the posted limit', () => {
    const { container } = renderOverlay({
      step: step({ type: 'off ramp', modifier: 'right', exitNumber: '42', speedLimit: 100 }),
    });
    expect(container.textContent).toContain('Exit');
    expect(container.textContent).toContain('42');
    expect(container.querySelector('.nav-limit')?.textContent).toBe('100');
  });

  it('marks the limit badge when the driver is over it, and not when inside the slack', () => {
    const fast = renderOverlay({ step: step({ speedLimit: 50 }), speedKmh: 70 });
    expect(fast.container.querySelector('.nav-limit')?.classList.contains('over')).toBe(true);
    cleanup();
    const close = renderOverlay({ step: step({ speedLimit: 50 }), speedKmh: 52 });
    expect(close.container.querySelector('.nav-limit')?.classList.contains('over')).toBe(false);
  });

  it('previews the next maneuver only when it is close', () => {
    const near = renderOverlay({ nextStep: step({ modifier: 'left', street: 'Side Road' }), distToNextM: 150 });
    expect(near.container.querySelector('.nav-then')?.textContent).toContain('then');
    cleanup();
    const far = renderOverlay({ nextStep: step({ modifier: 'left' }), distToNextM: 2000 });
    expect(far.container.querySelector('.nav-then')).toBeNull();
  });

  it('switches to the arrival card at the destination, without lanes or limits', () => {
    const { container } = renderOverlay({
      remainingM: 12,
      step: step({ type: 'arrive', lanes: [{ directions: ['left'], active: true }], speedLimit: 50 }),
    });
    expect(container.textContent).toContain("You've arrived");
    expect(container.querySelector('.nav-lanes')).toBeNull();
    expect(container.querySelector('.nav-limit')).toBeNull();
  });
});
