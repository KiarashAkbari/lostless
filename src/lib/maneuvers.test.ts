import { describe, it, expect } from 'vitest';
import { laneGlyph, maneuverGlyph, maneuverLabel } from './maneuvers';

describe('maneuverGlyph', () => {
  it('turns', () => {
    expect(maneuverGlyph({ type: 'turn', modifier: 'left' })).toBe('←');
    expect(maneuverGlyph({ type: 'turn', modifier: 'right' })).toBe('→');
    expect(maneuverGlyph({ type: 'turn', modifier: 'uturn' })).toBe('↺');
    expect(maneuverGlyph({ type: 'turn', modifier: 'straight' })).toBe('↑');
  });
  it('arrive / depart / roundabout / ferry', () => {
    expect(maneuverGlyph({ type: 'arrive' })).toBe('◉');
    expect(maneuverGlyph({ type: 'depart' })).toBe('◦');
    expect(maneuverGlyph({ type: 'roundabout', modifier: 'clockwise' })).toBe('↻');
    expect(maneuverGlyph({ type: 'ferry' })).toBe('≋');
  });
});

describe('maneuverLabel', () => {
  it('labels', () => {
    expect(maneuverLabel({ type: 'turn', modifier: 'left' })).toBe('turn left');
    expect(maneuverLabel({ type: 'arrive' })).toBe('arrive');
    expect(maneuverLabel({ type: 'fork', modifier: 'right' })).toBe('keep right');
    expect(maneuverLabel({ type: 'merge', modifier: 'left' })).toBe('merge left');
  });
});

describe('laneGlyph', () => {
  it('paints the arrow the driver will see on the tarmac', () => {
    expect(laneGlyph('left')).toBe('←');
    expect(laneGlyph('slight left')).toBe('↖');
    expect(laneGlyph('sharp left')).toBe('↙');
    expect(laneGlyph('straight')).toBe('↑');
    expect(laneGlyph('right')).toBe('→');
    expect(laneGlyph('slight right')).toBe('↗');
    expect(laneGlyph('sharp_right')).toBe('↘');
    expect(laneGlyph('u_turn')).toBe('↺');
    expect(laneGlyph('uturn')).toBe('↺');
    expect(laneGlyph('merge')).toBe('↗');
    expect(laneGlyph('')).toBe('↑');
    expect(laneGlyph('something new')).toBe('↑');
  });
});
