/**
 * calcul.worker — le calcul du profil, HORS du fil principal.
 *
 * Construit à part par `_outils/build.mjs` (import `?worker`), puis lancé
 * depuis une URL `blob:` : c'est la seule source de worker que la CSP de la
 * page bac à sable permet (`worker-src blob:`). Le worker hérite de cette CSP —
 * aucun réseau, aucun `importScripts` distant : il ne fait que déplacer du
 * calcul, ce qui garde l'interface fluide sur une trace de cent mille points.
 *
 * Pas de DOM ici : le worker reçoit des tableaux de nombres, déjà extraits du
 * GPX par le fil principal.
 */

import { calculerProfil, type SegmentBrut } from './profil';

interface Demande {
  id: number;
  segments: SegmentBrut[];
}

const portee = self as unknown as {
  onmessage: ((e: { data: Demande }) => void) | null;
  postMessage(message: unknown): void;
};

portee.onmessage = (e) => {
  const { id, segments } = e.data;
  try {
    portee.postMessage({ id, profil: calculerProfil(segments) });
  } catch (err) {
    portee.postMessage({ id, erreur: String((err as Error)?.message ?? err) });
  }
};
