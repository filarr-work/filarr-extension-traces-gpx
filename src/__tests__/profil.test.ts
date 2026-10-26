import { describe, expect, it } from 'vitest';
import { altitudeA, calculerProfil, denivele, echantillonner, haversine, pasRond, type Point } from '../profil';

describe('profil', () => {
  it('mesure la distance à la surface de la Terre', () => {
    // Un degré de latitude ≈ 111,2 km.
    expect(haversine([45, 6, null], [46, 6, null])).toBeCloseTo(111_195, -2);
    expect(haversine([45, 6, null], [45, 6, null])).toBe(0);
  });

  it('ignore le tremblement de l’altitude GPS sous le seuil', () => {
    const bruit = Array.from({ length: 200 }, (_, i) => 500 + (i % 2 ? 1.2 : -1.2));
    expect(denivele(bruit)).toEqual({ montee: 0, descente: 0 });
    expect(denivele([100, 110, 105, 120])).toEqual({ montee: 25, descente: 5 });
    expect(denivele([null, null])).toBeNull();
  });

  it('ne compte ni la distance ni le dénivelé ENTRE deux segments', () => {
    const a: Point[] = [
      [45, 6, 1000],
      [45.01, 6, 1100],
    ];
    const b: Point[] = [
      [46, 6, 2000],
      [46.01, 6, 1900],
    ];
    const p = calculerProfil([
      { nom: 'a', points: a },
      { nom: 'b', points: b },
    ]);
    expect(p.distanceM).toBeCloseTo(2 * 1112, -1);
    expect(p.montee).toBe(100);
    expect(p.descente).toBe(100);
    expect(p.debuts).toEqual([0, p.segments[0].distanceM]);
    expect([p.altMin, p.altMax]).toEqual([1000, 2000]);
  });

  it('se passe d’altitudes, sans en inventer', () => {
    const p = calculerProfil([{ nom: '', points: [[45, 6, null], [45.001, 6, null]] }]);
    expect(p.montee).toBeNull();
    expect(p.echantillons).toEqual([]);
    expect(p.distanceM).toBeGreaterThan(100);
  });

  it('échantillonne en gardant les extrémités', () => {
    const pts = Array.from({ length: 2000 }, (_, i) => [i, i] as [number, number]);
    const e = echantillonner(pts, 500);
    expect(e).toHaveLength(500);
    expect(e[0]).toEqual([0, 0]);
    expect(e[499]).toEqual([1999, 1999]);
  });

  it('interpole l’altitude et choisit des graduations rondes', () => {
    expect(altitudeA([[0, 100], [100, 200]], 25)).toBe(125);
    expect(altitudeA([], 3)).toBeNull();
    expect(pasRond(12.4, 6)).toBe(2);
    expect(pasRond(1080, 4)).toBe(200);
    expect(pasRond(0)).toBe(1);
  });
});
