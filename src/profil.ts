/**
 * profil — distance, dénivelé et profil d'altitude d'une trace. PUR : ni DOM,
 * ni hôte, ni `DOMParser` — ce module tourne aussi dans le Web Worker, qui n'a
 * pas de DOM.
 *
 * LE DÉNIVELÉ. Une altitude GPS tremble de quelques mètres d'un point à
 * l'autre ; additionner chaque petite montée gonflerait le dénivelé d'une
 * sortie à plat de plusieurs centaines de mètres. On applique donc un SEUIL
 * d'hystérésis : une montée ne compte qu'une fois qu'elle a dépassé
 * `SEUIL_DENIVELE_M` depuis le dernier point bas (et symétriquement pour la
 * descente). C'est la méthode des montres de sport, et elle est stable : le
 * même fichier donne toujours le même chiffre.
 *
 * LA DISTANCE. Formule de haversine sur une sphère de rayon moyen terrestre :
 * à moins de 0,5 % près, c'est ce qu'affichent les applications de randonnée.
 * Les segments ne sont pas reliés entre eux : un saut entre deux `<trk>` (un
 * trajet en voiture, une pause GPS) ne compte pas.
 */

/** [latitude, longitude, altitude ou null]. */
export type Point = [number, number, number | null];

export interface SegmentBrut {
  nom: string;
  points: Point[];
}

export interface StatsSegment {
  distanceM: number;
  montee: number | null;
  descente: number | null;
}

export interface Profil {
  distanceM: number;
  montee: number | null;
  descente: number | null;
  altMin: number | null;
  altMax: number | null;
  /** Le profil échantillonné : [distance en mètres, altitude]. */
  echantillons: [number, number][];
  /** Où commence chaque segment, en mètres depuis le départ. */
  debuts: number[];
  segments: StatsSegment[];
  points: number;
}

export const RAYON_TERRE_M = 6_371_008.8;
export const SEUIL_DENIVELE_M = 3;
export const ECHANTILLONS_MAX = 500;

const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: Point, b: Point): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Montée et descente cumulées, filtrées par le seuil d'hystérésis. `null` sans altitude. */
export function denivele(altitudes: (number | null)[], seuil = SEUIL_DENIVELE_M): { montee: number; descente: number } | null {
  const alts = altitudes.filter((a): a is number => a !== null && Number.isFinite(a));
  if (alts.length === 0) return null;
  let montee = 0;
  let descente = 0;
  let reference = alts[0];
  for (const a of alts) {
    if (a - reference >= seuil) {
      montee += a - reference;
      reference = a;
    } else if (reference - a >= seuil) {
      descente += reference - a;
      reference = a;
    }
  }
  return { montee, descente };
}

/** Garde au plus `max` points du profil, en conservant le premier et le dernier. */
export function echantillonner(points: [number, number][], max = ECHANTILLONS_MAX): [number, number][] {
  if (points.length <= max) return points;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  return out;
}

export function calculerProfil(segments: SegmentBrut[]): Profil {
  let distance = 0;
  const profil: [number, number][] = [];
  const debuts: number[] = [];
  const stats: StatsSegment[] = [];
  const toutes: (number | null)[] = [];
  let montee: number | null = null;
  let descente: number | null = null;
  let points = 0;

  for (const s of segments) {
    debuts.push(distance);
    let d = 0;
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i];
      if (i > 0) d += haversine(s.points[i - 1], p);
      if (p[2] !== null) profil.push([distance + d, p[2]]);
      toutes.push(p[2]);
    }
    points += s.points.length;
    // Le dénivelé se cumule PAR segment : un saut d'altitude entre deux
    // segments disjoints n'est pas une montée.
    const dv = denivele(s.points.map((p) => p[2]));
    if (dv) {
      montee = (montee ?? 0) + dv.montee;
      descente = (descente ?? 0) + dv.descente;
    }
    stats.push({ distanceM: d, montee: dv ? dv.montee : null, descente: dv ? dv.descente : null });
    distance += d;
  }

  const alts = toutes.filter((a): a is number => a !== null);
  return {
    distanceM: distance,
    montee,
    descente,
    altMin: alts.length ? Math.min(...alts) : null,
    altMax: alts.length ? Math.max(...alts) : null,
    echantillons: echantillonner(profil),
    debuts,
    segments: stats,
    points,
  };
}

/** Un pas de graduation « rond » (1, 2, 5 × 10ⁿ), le plus proche de `etendue / n`. */
export function pasRond(etendue: number, n = 5): number {
  if (!(etendue > 0)) return 1;
  const brut = etendue / n;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  return [1, 2, 5, 10].map((m) => m * puissance).reduce((a, b) => (Math.abs(b - brut) < Math.abs(a - brut) ? b : a));
}

/** L'altitude à une distance donnée, par interpolation dans le profil échantillonné. */
export function altitudeA(echantillons: [number, number][], distanceM: number): number | null {
  if (echantillons.length === 0) return null;
  if (distanceM <= echantillons[0][0]) return echantillons[0][1];
  for (let i = 1; i < echantillons.length; i++) {
    const [d1, a1] = echantillons[i];
    if (distanceM <= d1) {
      const [d0, a0] = echantillons[i - 1];
      return d1 === d0 ? a1 : a0 + ((a1 - a0) * (distanceM - d0)) / (d1 - d0);
    }
  }
  return echantillons[echantillons.length - 1][1];
}
