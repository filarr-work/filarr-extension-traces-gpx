/**
 * Traces GPX — profil d'altitude, distance, dénivelé, et segments renommables.
 *
 * Ce que l'exemple montre :
 *  - un Web Worker créé depuis un `blob:` pour le calcul (`calculateur.ts`),
 *    avec repli sur le fil principal ;
 *  - trois fonctions pures (`fonctions.ts`) : vignette du profil, champs
 *    `distance_km`/`denivele_m` pour la vue tableau, nom de la trace pour la
 *    recherche ;
 *  - une réécriture CHIRURGICALE d'un format tiers : seuls les `<name>`
 *    changés sont touchés, et un fichier ouvert sans modification se rend à
 *    l'octet près (`gpx.ts`).
 */

import { creerCalculateur } from './calculateur';
import { creerEcouteurs, el, estRaccourciEnregistrer, feuille } from './dom';
import { creerBarreEtat } from './etat';
import { fonctions } from './fonctions';
import { ecrireGpx, lireGpx, nettoyerNom, nomsDe } from './gpx';
import { creerGraphique } from './graphique';
import { TEXTES, langueDe } from './i18n';
import type { Profil } from './profil';
import { creerSauvegarde } from './sauvegarde';
import { CSS } from './style';

export const EDITOR_ID = 'traces-gpx-editor';

function mount(host: FilarrHost): FilarrEditorInstance {
  const langue = langueDe(host.locale);
  const t = TEXTES[langue];
  const fmt = (n: number, dec = 0) => n.toLocaleString(langue, { maximumFractionDigits: dec, minimumFractionDigits: dec });
  const ecoute = creerEcouteurs();
  host.container.textContent = '';
  const style = feuille(CSS);
  const racine = el('div', { classe: 'gx', attrs: { lang: langue, 'data-schema': host.theme.scheme } });
  host.container.append(style, racine);
  const desabonnerTheme = host.onThemeChange((theme) => {
    racine.dataset.schema = theme.scheme;
  });

  const lu = lireGpx(host.initialBytes);
  if (!lu.ok) {
    racine.append(el('div', { classe: 'etat-alerte', attrs: { role: 'alert' }, texte: lu.raison === 'xml' ? t.illisible : t.pasGpx }));
    const original = host.initialBytes.slice();
    return {
      destroy() {
        desabonnerTheme();
        racine.remove();
        style.remove();
      },
      getBytes: () => original.slice(),
    };
  }

  const trace = lu.trace;
  const noms = nomsDe(trace);
  let profil: Profil | null = null;
  let detruit = false;

  const barre = creerBarreEtat(t, langue, host.readOnly);
  const sauvegarde = creerSauvegarde({
    lectureSeule: host.readOnly,
    enregistrer: () => host.saveBytes(ecrireGpx(trace, noms)),
    signalerSale: (sale) => host.onDirty(sale),
    surEtat: barre.afficher,
  });

  // ── En-tête et chiffres ──
  const titre = el('h1', { classe: 'gx-titre', texte: trace.nom ?? t.sansNom });
  const stats = el('dl', { classe: 'gx-stats' });
  const tuile = (libelle: string, valeur: string) =>
    el('div', { classe: 'gx-tuile' }, [el('dt', { texte: libelle }), el('dd', { texte: valeur })]);
  const cadre = el('div', { classe: 'gx-cadre' }, [el('p', { classe: 'gx-message', texte: t.calcul })]);
  const note = el('p', { classe: 'gx-note' });
  const graphique = creerGraphique(t, langue);

  // ── Les segments, renommables ──
  const corps = el('tbody');
  const lignes = trace.segments.map((s, i) => {
    const champ = el('input', {
      classe: 'gx-nom',
      attrs: { type: 'text', 'aria-label': t.nomSegment(i + 1), placeholder: t.segmentSansNom(i + 1), maxlength: 200, 'data-segment': i },
    });
    champ.value = s.nom;
    champ.readOnly = host.readOnly;
    ecoute.sur(champ, 'input', () => {
      noms[i] = nettoyerNom(champ.value);
      if (profil) graphique.dessiner(profil, noms);
      sauvegarde.modifie();
    });
    const cellules = [el('td', { texte: '…' }), el('td', { texte: '…' }), el('td', { texte: '…' })];
    corps.append(el('tr', {}, [el('td', {}, [champ]), ...cellules]));
    return cellules;
  });
  const tableau = el('table', { classe: 'gx-segments' }, [
    el('caption', { texte: t.segments }),
    el('thead', {}, [
      el('tr', {}, [t.colNom, t.colDistance, t.colMontee, t.colDescente].map((c) => el('th', { texte: c, attrs: { scope: 'col' } }))),
    ]),
    corps,
  ]);

  racine.append(
    el('header', { classe: 'gx-entete' }, [titre, el('span', { classe: 'gx-fichier', texte: host.fileName }), barre.statut]),
    barre.alerte,
    stats,
    cadre,
    note
  );
  if (trace.segments.length > 0) racine.append(tableau);

  const metres = (v: number | null) => (v === null ? '—' : `${fmt(v)} m`);

  function afficher(p: Profil, enWorker: boolean): void {
    stats.textContent = '';
    stats.append(
      tuile(t.distance, `${fmt(p.distanceM / 1000, 2)} km`),
      tuile(t.montee, metres(p.montee)),
      tuile(t.descente, metres(p.descente)),
      tuile(t.altitudes, p.altMin === null || p.altMax === null ? '—' : `${fmt(p.altMin)} – ${fmt(p.altMax)} m`),
      tuile(t.points, fmt(p.points))
    );
    cadre.textContent = '';
    if (p.points === 0) cadre.append(el('p', { classe: 'gx-message', texte: t.aucunPoint }));
    else if (p.echantillons.length < 2) cadre.append(el('p', { classe: 'gx-message', texte: t.pasAltitude }));
    else {
      cadre.append(graphique.element);
      graphique.dessiner(p, noms);
    }
    note.textContent = enWorker ? t.enWorker : t.surFil;
    p.segments.forEach((s, i) => {
      const [d, plus, moins] = lignes[i] ?? [];
      if (!d) return;
      d.textContent = `${fmt(s.distanceM / 1000, 2)} km`;
      plus.textContent = metres(s.montee);
      moins.textContent = metres(s.descente);
    });
  }

  // Monté tout de suite, profil ensuite : `mount` ne bloque pas sur le calcul.
  const calculateur = creerCalculateur();
  const enWorker = calculateur.enWorker;
  calculateur.calculer(trace.segments).then(
    (p) => {
      if (detruit) return;
      profil = p;
      afficher(p, enWorker);
    },
    (e: unknown) => {
      if (!detruit) cadre.textContent = String((e as Error)?.message ?? e);
    }
  );

  ecoute.sur(racine, 'keydown', (e) => {
    if (!estRaccourciEnregistrer(e as KeyboardEvent)) return;
    e.preventDefault();
    if (!host.readOnly) sauvegarde.maintenant();
  });

  return {
    destroy() {
      detruit = true;
      calculateur.detruire();
      sauvegarde.detruire();
      desabonnerTheme();
      ecoute.tout();
      racine.remove();
      style.remove();
    },
    getBytes: () => ecrireGpx(trace, noms),
  };
}

const ids = [EDITOR_ID];
for (let i = 1; i <= 8; i++) ids.push(`dev-local-${i}-editor`);

globalThis.filarrSandboxedPlugin = {
  editors: ids.map((id) => ({ id, mount })),
  functions: fonctions,
};
