/**
 * fonctions — ce que Filarr appelle sans ouvrir l'éditeur (capacité `functions`) :
 *
 *  - `thumbnail` : le profil d'altitude en PNG (≤ 96 Kio), pour la carte du fichier ;
 *  - `fields` : `distance_km` et `denivele_m`, pour la vue tableau d'un dossier
 *    de traces — construite PAR FILARR, l'extension ne voit jamais le dossier ;
 *  - `extractText` : le nom de la trace et de ses segments, pour la recherche.
 *
 * Une page de fonctions n'a ni stockage, ni sélecteur, ni réseau, et n'affiche
 * rien ; elle a `DOMParser`, ce qui suffit à lire le GPX. Le calcul se fait ici
 * directement : un appel a dix secondes, et le lot de pages est jetable — un
 * worker n'y gagnerait rien.
 */

import { lireGpx } from './gpx';
import { Toile } from './png';
import { calculerProfil, type Profil } from './profil';

const L = 192;
const H = 96;

function lire(octets: Uint8Array) {
  const lu = lireGpx(octets);
  if (!lu.ok) throw new Error('GPX illisible');
  return lu.trace;
}

/** Le profil en vignette : l'aire sous la courbe, et la courbe par-dessus. */
export function vignetteProfil(p: Profil): Uint8Array {
  const toile = new Toile(L, H, [248, 250, 252]);
  const aire = toile.indice([191, 219, 254]);
  const ligne = toile.indice([37, 99, 235]);
  const e = p.echantillons;
  if (e.length >= 2 && p.distanceM > 0 && p.altMin !== null && p.altMax !== null) {
    // Une marge en haut, et une étendue d'au moins 50 m : une trace plate ne
    // doit pas ressembler à une falaise.
    const etendue = Math.max(50, p.altMax - p.altMin);
    const bas = p.altMin - etendue * 0.1;
    const y = (a: number) => 6 + (1 - (a - bas) / (etendue * 1.1)) * (H - 10);
    const x = (d: number) => (d / p.distanceM) * (L - 1);
    let k = 0;
    for (let px = 0; px < L; px++) {
      const d = (px / (L - 1)) * p.distanceM;
      while (k < e.length - 2 && e[k + 1][0] < d) k++;
      const [d0, a0] = e[k];
      const [d1, a1] = e[k + 1];
      const a = d1 === d0 ? a1 : a0 + ((a1 - a0) * (d - d0)) / (d1 - d0);
      toile.colonne(px, y(a), aire);
    }
    for (let i = 1; i < e.length; i++) toile.segment(x(e[i - 1][0]), y(e[i - 1][1]), x(e[i][0]), y(e[i][1]), 1, ligne);
  } else {
    // Sans altitude : un trait plat, qui dit « une trace » sans rien inventer.
    toile.segment(8, H / 2, L - 8, H / 2, 1.5, ligne);
  }
  return toile.png();
}

export const fonctions: FilarrFunctions = {
  thumbnail(octets) {
    return vignetteProfil(calculerProfil(lire(octets).segments));
  },
  fields(octets) {
    const p = calculerProfil(lire(octets).segments);
    return {
      distance_km: Math.round(p.distanceM / 10) / 100,
      denivele_m: p.montee === null ? null : Math.round(p.montee),
    };
  },
  extractText(octets) {
    const t = lire(octets);
    const noms = [t.nom ?? '', ...t.segments.map((s) => s.nom)].filter((n, i, tous) => n && tous.indexOf(n) === i);
    return noms.join('\n');
  },
};
