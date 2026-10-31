import { describe, it, expect } from 'vitest';
import { maneuverGlyph, maneuverLabel } from './maneuvers';

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
