/**
 * gpx — lire un fichier GPX et y réécrire le nom des segments.
 *
 * Un SEGMENT, ici, est un `<trk>` : c'est lui que GPX 1.1 sait nommer
 * (`<trk><name>`), et que les autres applications affichent. Les `<trkseg>`
 * d'un même `<trk>` (une coupure du signal) restent un seul segment.
 *
 * LE PRINCIPE DE LA RÉÉCRITURE : on ne touche qu'à ce que l'utilisateur a
 * changé. Tant qu'aucun nom n'a bougé, `ecrireGpx` rend les octets d'ORIGINE,
 * à l'identique — un GPX porte des extensions de montres et d'applications
 * (fréquence cardiaque, cadence…) qu'un éditeur ne doit pas abîmer en le
 * resérialisant pour rien. Quand un nom change, seul l'élément `<name>` de ce
 * `<trk>` est modifié dans le document, puis le tout est resérialisé : les
 * points, les temps et les extensions passent tels quels.
 *
 * `DOMParser` existe dans la page bac à sable (éditeur et fonctions pures),
 * pas dans le Web Worker : le calcul du profil (`profil.ts`) ne reçoit donc
 * que des tableaux de nombres.
 */

import type { Point, SegmentBrut } from './profil';

export const NOM_MAX = 200;

export interface Trace {
  /** Le document analysé : la base de toute réécriture. */
  doc: XMLDocument;
  /** `<metadata><name>`, sinon le nom du premier segment. */
  nom: string | null;
  segments: SegmentBrut[];
  /** Les octets lus — rendus tels quels tant que rien n'a changé. */
  original: Uint8Array;
  declaration: boolean;
}

export type Lecture = { ok: true; trace: Trace } | { ok: false; raison: 'xml' | 'pas_gpx' };

/** Le GPX d'un document neuf : une trace vide, prête à recevoir des segments d'une autre application. */
export const GPX_VIDE =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<gpx version="1.1" creator="Filarr traces-gpx" xmlns="http://www.topografix.com/GPX/1/1">\n' +
  '  <metadata><name></name></metadata>\n' +
  '</gpx>\n';

const enfant = (parent: Element, nom: string): Element | null => {
  for (const c of Array.from(parent.children)) if (c.localName === nom) return c;
  return null;
};

const nombre = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function lireGpx(octets: Uint8Array): Lecture {
  // 0 octet : document neuf. On part d'une trace vide, sans rien inventer.
  const source = octets.byteLength === 0 ? new TextEncoder().encode(GPX_VIDE) : octets;
  let texte: string;
  try {
    texte = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    return { ok: false, raison: 'xml' };
  }
  const doc = new DOMParser().parseFromString(texte, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, raison: 'xml' };
  const racine = doc.documentElement;
  if (!racine || racine.localName !== 'gpx') return { ok: false, raison: 'pas_gpx' };

  const segments: SegmentBrut[] = [];
  for (const trk of Array.from(racine.children).filter((e) => e.localName === 'trk')) {
    const points: Point[] = [];
    for (const pt of Array.from(trk.getElementsByTagNameNS('*', 'trkpt'))) {
      const lat = nombre(pt.getAttribute('lat'));
      const lon = nombre(pt.getAttribute('lon'));
      if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const ele = enfant(pt, 'ele');
      points.push([lat, lon, nombre(ele?.textContent)]);
    }
    segments.push({ nom: enfant(trk, 'name')?.textContent?.trim() ?? '', points });
  }
  const meta = enfant(racine, 'metadata');
  const nomMeta = meta ? enfant(meta, 'name')?.textContent?.trim() : '';
  return {
    ok: true,
    trace: {
      doc,
      nom: nomMeta || segments.find((s) => s.nom)?.nom || null,
      segments,
      original: octets.byteLength === 0 ? source : octets,
      declaration: /^\s*<\?xml/.test(texte),
    },
  };
}

/** Les noms que l'utilisateur a pu changer, segment par segment. */
export function nomsDe(t: Trace): string[] {
  return t.segments.map((s) => s.nom);
}

export function nettoyerNom(nom: string): string {
  return nom.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, NOM_MAX);
}

/**
 * Les octets du GPX avec ces noms de segments. Rien de changé : l'original, à
 * l'identique. Sinon : une COPIE du document, ses seuls `<name>` retouchés.
 */
export function ecrireGpx(t: Trace, noms: string[]): Uint8Array {
  const avant = nomsDe(t);
  if (noms.length === avant.length && noms.every((n, i) => n.trim() === avant[i])) return t.original.slice();
  const copie = t.doc.cloneNode(true) as XMLDocument;
  const trks = Array.from(copie.documentElement.children).filter((e) => e.localName === 'trk');
  trks.forEach((trk, i) => {
    const voulu = (noms[i] ?? '').trim();
    if (voulu === avant[i]) return;
    let nom = enfant(trk, 'name');
    if (voulu === '') {
      nom?.remove();
      return;
    }
    if (!nom) {
      // Même espace de noms que le <trk> (GPX 1.0 ou 1.1), et en PREMIER : le schéma l'exige.
      nom = copie.createElementNS(trk.namespaceURI, trk.prefix ? `${trk.prefix}:name` : 'name');
      trk.insertBefore(nom, trk.firstChild);
    }
    nom.textContent = voulu;
  });
  const xml = new XMLSerializer().serializeToString(copie);
  const declaration = t.declaration && !xml.startsWith('<?xml') ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '';
  return new TextEncoder().encode(declaration + xml + (xml.endsWith('\n') ? '' : '\n'));
}
