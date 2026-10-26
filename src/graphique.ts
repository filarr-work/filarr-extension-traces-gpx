/**
 * graphique — le profil d'altitude en SVG, parcourable au clavier.
 *
 * Le graphique est un CURSEUR (`role="slider"`) : flèches, Page préc./suiv.,
 * Début/Fin déplacent un repère le long de la trace, et le lecteur d'écran lit
 * « 12,4 km, altitude 1 845 m ». La souris (ou le doigt) fait la même chose en
 * survolant. Les couleurs sont des variables du thème de Filarr : rien à
 * recalculer quand il change.
 *
 * Tout texte posé dans le SVG est un NOMBRE formaté ou un nom de segment, par
 * `textContent` : rien n'est interprété.
 */

import { svg } from './dom';
import type { Textes } from './i18n';
import { altitudeA, pasRond, type Profil } from './profil';

const VL = 1000;
const VH = 320;
const M = { g: 56, d: 16, h: 24, b: 40 };

/** Largeur estimée d'un nom de segment à 12 unités de police (on dessine hors page : rien à mesurer). */
export const largeurNom = (texte: string): number => Math.ceil(texte.length * 6.6);

/**
 * La RANGÉE de chaque nom de segment : la première où le nom précédent est
 * fini, au plus `max` rangées ; sinon celle qui se libère le plus tôt. Un
 * segment court ne fait plus écrire son nom par-dessus celui du suivant.
 */
export function rangsNoms(departs: number[], largeurs: number[], max = 3, ecart = 8): number[] {
  const fins: number[] = [];
  return departs.map((x, i) => {
    let rang = fins.findIndex((fin) => x >= fin);
    if (rang === -1) rang = fins.length < max ? fins.length : fins.indexOf(Math.min(...fins));
    fins[rang] = x + largeurs[i] + ecart;
    return rang;
  });
}

export interface Graphique {
  element: SVGSVGElement;
  dessiner(p: Profil, noms: string[]): void;
}

export function creerGraphique(t: Textes, langue: string): Graphique {
  const fmt = (n: number, dec = 0) => n.toLocaleString(langue, { maximumFractionDigits: dec, minimumFractionDigits: dec });
  const grille = svg('g', { class: 'gx-grille' });
  const aire = svg('path', { class: 'gx-aire' });
  const ligne = svg('path', { class: 'gx-ligne' });
  const limites = svg('g', { class: 'gx-limites' });
  const repere = svg('line', { class: 'gx-repere', y1: M.h, y2: VH - M.b });
  const point = svg('circle', { class: 'gx-point', r: 5 });
  const lecture = svg('text', { class: 'gx-lecture', y: M.h - 8 });
  const element = svg('svg', {
    class: 'gx-graphique',
    viewBox: `0 0 ${VL} ${VH}`,
    tabindex: 0,
    role: 'slider',
    'aria-label': t.profil,
    'aria-valuemin': 0,
  }, [grille, aire, ligne, limites, repere, point, lecture]);

  let profil: Profil | null = null;
  let position = 0;

  const largeurUtile = VL - M.g - M.d;
  const hauteurUtile = VH - M.h - M.b;
  let bas = 0;
  let etendue = 1;
  const x = (d: number) => M.g + (profil && profil.distanceM > 0 ? (d / profil.distanceM) * largeurUtile : 0);
  const y = (a: number) => M.h + (1 - (a - bas) / etendue) * hauteurUtile;

  function placer(d: number): void {
    if (!profil) return;
    position = Math.min(profil.distanceM, Math.max(0, d));
    const a = altitudeA(profil.echantillons, position) ?? 0;
    const km = fmt(position / 1000, 2);
    const alt = fmt(a);
    repere.setAttribute('x1', String(x(position)));
    repere.setAttribute('x2', String(x(position)));
    point.setAttribute('cx', String(x(position)));
    point.setAttribute('cy', String(y(a)));
    lecture.setAttribute('x', String(Math.min(VL - 160, Math.max(M.g, x(position) - 60))));
    lecture.textContent = t.curseur(km, alt);
    element.setAttribute('aria-valuenow', String(Math.round(position)));
    element.setAttribute('aria-valuetext', t.curseur(km, alt));
  }

  element.addEventListener('keydown', (e) => {
    if (!profil || profil.distanceM <= 0) return;
    const pas = profil.distanceM / 100;
    const deltas: Record<string, number> = {
      ArrowRight: pas,
      ArrowUp: pas,
      ArrowLeft: -pas,
      ArrowDown: -pas,
      PageUp: pas * 10,
      PageDown: -pas * 10,
    };
    if (e.key in deltas) placer(position + deltas[e.key]);
    else if (e.key === 'Home') placer(0);
    else if (e.key === 'End') placer(profil.distanceM);
    else return;
    e.preventDefault();
  });
  element.addEventListener('pointermove', (e) => {
    if (!profil) return;
    const r = element.getBoundingClientRect();
    if (r.width === 0) return;
    const vx = ((e.clientX - r.left) / r.width) * VL;
    placer(((vx - M.g) / largeurUtile) * profil.distanceM);
  });

  return {
    element,
    dessiner(p, noms) {
      profil = p;
      const e = p.echantillons;
      grille.textContent = '';
      limites.textContent = '';
      element.setAttribute('aria-valuemax', String(Math.round(p.distanceM)));
      if (e.length < 2 || p.altMin === null || p.altMax === null) return;
      // Au moins 50 m d'étendue : une trace plate ne doit pas ressembler à une falaise.
      const plage = Math.max(50, p.altMax - p.altMin);
      const pasAlt = pasRond(plage, 4);
      bas = Math.floor((p.altMin - plage * 0.05) / pasAlt) * pasAlt;
      etendue = Math.ceil((p.altMax + plage * 0.05) / pasAlt) * pasAlt - bas;

      for (let a = bas; a <= bas + etendue + 1e-6; a += pasAlt) {
        grille.append(svg('line', { x1: M.g, x2: VL - M.d, y1: y(a), y2: y(a) }));
        const etiquette = svg('text', { x: M.g - 6, y: y(a) + 4, 'text-anchor': 'end' });
        etiquette.textContent = `${fmt(a)} m`;
        grille.append(etiquette);
      }
      const km = p.distanceM / 1000;
      const pasKm = pasRond(km, 6);
      for (let k = 0; k <= km + 1e-9; k += pasKm) {
        const etiquette = svg('text', { x: x(k * 1000), y: VH - M.b + 18, 'text-anchor': 'middle' });
        etiquette.textContent = `${fmt(k, pasKm < 1 ? 1 : 0)} km`;
        grille.append(etiquette);
      }

      const pts = e.map(([d, a]) => `${x(d).toFixed(1)} ${y(a).toFixed(1)}`);
      ligne.setAttribute('d', `M${pts.join('L')}`);
      aire.setAttribute('d', `M${x(e[0][0]).toFixed(1)} ${VH - M.b}L${pts.join('L')}L${x(e[e.length - 1][0]).toFixed(1)} ${VH - M.b}Z`);

      const textes = p.debuts.map((_, i) => (noms[i] || t.segmentSansNom(i + 1)).slice(0, 28));
      const rangs = rangsNoms(p.debuts.map((d) => x(d) + 4), textes.map(largeurNom));
      p.debuts.forEach((d, i) => {
        if (i > 0) limites.append(svg('line', { x1: x(d), x2: x(d), y1: M.h, y2: VH - M.b }));
        const nom = svg('text', { x: x(d) + 4, y: M.h + 14 + rangs[i] * 14 });
        nom.textContent = textes[i];
        limites.append(nom);
      });
      placer(position);
    },
  };
}
