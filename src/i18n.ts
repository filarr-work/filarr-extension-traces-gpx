/**
 * i18n — français si Filarr est en français, anglais sinon (`host.locale`).
 * Les nombres suivent la langue (« 12,4 km » / « 12.4 km »).
 */

import type { TextesEtat } from './etat';

export type Langue = 'fr' | 'en';

export function langueDe(locale: string): Langue {
  return /^fr\b/i.test(locale) ? 'fr' : 'en';
}

export interface Textes extends TextesEtat {
  sansNom: string;
  distance: string;
  montee: string;
  descente: string;
  altitudes: string;
  points: string;
  calcul: string;
  enWorker: string;
  surFil: string;
  profil: string;
  curseur: (km: string, alt: string) => string;
  pasAltitude: string;
  segments: string;
  colNom: string;
  colDistance: string;
  colMontee: string;
  colDescente: string;
  nomSegment: (n: number) => string;
  segmentSansNom: (n: number) => string;
  aucunPoint: string;
  illisible: string;
  pasGpx: string;
}

export const TEXTES: Record<Langue, Textes> = {
  fr: {
    sansNom: 'Trace sans nom',
    distance: 'Distance',
    montee: 'Dénivelé positif',
    descente: 'Dénivelé négatif',
    altitudes: 'Altitude min. – max.',
    points: 'Points',
    calcul: 'Calcul du profil…',
    enWorker: 'calculé hors du fil principal (Web Worker)',
    surFil: 'calculé sur le fil principal',
    profil: "Profil d'altitude. Flèches pour parcourir la trace.",
    curseur: (km, alt) => `${km} km, altitude ${alt} m`,
    pasAltitude: "Ce fichier ne contient pas d'altitudes : pas de profil à dessiner.",
    segments: 'Segments',
    colNom: 'Nom',
    colDistance: 'Distance',
    colMontee: 'D+',
    colDescente: 'D−',
    nomSegment: (n) => `Nom du segment ${n}`,
    segmentSansNom: (n) => `Segment ${n}`,
    aucunPoint: "Cette trace ne contient aucun point. Ouvrez un GPX exporté d'une montre ou d'une application.",
    illisible: "Ce fichier n'est pas un XML lisible. Il est laissé intact : rien ne sera enregistré.",
    pasGpx: "Ce fichier XML n'est pas un GPX. Il est laissé intact : rien ne sera enregistré.",
    modifie: 'Modifié',
    enregistrement: 'Enregistrement…',
    enregistre: (h) => `Enregistré à ${h}`,
    lectureSeule: 'Lecture seule',
    conflit:
      "Conflit : cette trace a été enregistrée ailleurs depuis son ouverture. Appuyez sur Ctrl+S pour l'écraser délibérément, ou rouvrez-la.",
    refusLectureSeule: 'Lecture seule : vos modifications ne seront pas enregistrées.',
    erreur: (code) => `L'enregistrement a échoué (${code}). Vos modifications sont gardées.`,
  },
  en: {
    sansNom: 'Untitled track',
    distance: 'Distance',
    montee: 'Elevation gain',
    descente: 'Elevation loss',
    altitudes: 'Min – max elevation',
    points: 'Points',
    calcul: 'Computing the profile…',
    enWorker: 'computed off the main thread (Web Worker)',
    surFil: 'computed on the main thread',
    profil: 'Elevation profile. Use the arrow keys to walk the track.',
    curseur: (km, alt) => `${km} km, elevation ${alt} m`,
    pasAltitude: 'This file has no elevations: no profile to draw.',
    segments: 'Segments',
    colNom: 'Name',
    colDistance: 'Distance',
    colMontee: 'Gain',
    colDescente: 'Loss',
    nomSegment: (n) => `Name of segment ${n}`,
    segmentSansNom: (n) => `Segment ${n}`,
    aucunPoint: 'This track has no points. Open a GPX exported from a watch or an app.',
    illisible: 'This file is not readable XML. It is left untouched: nothing will be saved.',
    pasGpx: 'This XML file is not a GPX. It is left untouched: nothing will be saved.',
    modifie: 'Modified',
    enregistrement: 'Saving…',
    enregistre: (h) => `Saved at ${h}`,
    lectureSeule: 'Read-only',
    conflit:
      'Conflict: this track was saved elsewhere since you opened it. Press Ctrl+S to overwrite it on purpose, or reopen it.',
    refusLectureSeule: 'Read-only: your changes will not be saved.',
    erreur: (code) => `Saving failed (${code}). Your changes are kept.`,
  },
};
