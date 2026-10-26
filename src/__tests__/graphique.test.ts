import { describe, expect, it } from 'vitest';
import { largeurNom, rangsNoms } from '../graphique';

describe('rangsNoms', () => {
  it('un nom qui déborde sur le suivant le fait descendre d’une rangée', () => {
    // L'Aiguillette des Houches : 4,57 km, 0,78 km, 3,99 km sur 928 unités utiles.
    const departs = [60, 514, 592];
    const largeurs = ['Montée par la forêt', 'Crête & Aiguillette', 'Descente sur le Coupeau'].map(largeurNom);
    expect(rangsNoms(departs, largeurs)).toEqual([0, 0, 1]);
  });

  it('assez de place : tout sur la première rangée', () => {
    expect(rangsNoms([0, 300, 600], [100, 100, 100])).toEqual([0, 0, 0]);
  });

  it('au-delà de trois rangées, celle qui se libère le plus tôt', () => {
    expect(rangsNoms([0, 10, 20, 30], [200, 100, 300, 50])).toEqual([0, 1, 2, 1]);
  });
});
