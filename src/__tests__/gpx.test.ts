// @vitest-environment jsdom
// DOMParser et XMLSerializer : présents dans la page bac à sable, fournis ici par jsdom.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fonctions } from '../fonctions';
import { GPX_VIDE, ecrireGpx, lireGpx, nettoyerNom, nomsDe, type Trace } from '../gpx';
import { calculerProfil } from '../profil';

// Sous jsdom, `URL` est celui de la page : on passe par un chemin, pas par un objet URL.
const ici = dirname(fileURLToPath(import.meta.url));
const exemple = (nom: string) => new Uint8Array(readFileSync(join(ici, '..', '..', 'exemples', nom)));
const ctx = { fileName: 'x.gpx', locale: 'fr' };
const lire = (o: Uint8Array): Trace => {
  const lu = lireGpx(o);
  if (!lu.ok) throw new Error(lu.raison);
  return lu.trace;
};
const texte = (o: Uint8Array) => new TextDecoder().decode(o);

describe('lecture GPX', () => {
  it('lit les segments, leurs noms, leurs points', () => {
    const t = lire(exemple('aiguillette-des-houches.gpx'));
    expect(t.nom).toBe('Aiguillette des Houches par le Coupeau');
    expect(nomsDe(t)).toEqual(['Montée par la forêt', 'Crête & Aiguillette', 'Descente sur le Coupeau']);
    expect(t.segments.map((s) => s.points.length)).toEqual([161, 61, 171]);
    expect(t.segments[0].points[0][2]).toBeCloseTo(1105.1);
  });

  it('réunit les <trkseg> d’un même <trk> et accepte GPX 1.0 sans altitude', () => {
    const f = lire(exemple('footing-canal.gpx'));
    expect(f.segments).toHaveLength(1);
    expect(f.segments[0].points).toHaveLength(172);
    expect(f.nom).toBeNull();
    const v = lire(exemple('velo-sans-altitude.gpx'));
    expect(v.nom).toBe('Toulouse – Saint-Jean à vélo');
    expect(v.segments[0].points.every((p) => p[2] === null)).toBe(true);
  });

  it('0 octet = trace vide, sans rien inventer', () => {
    const t = lire(new Uint8Array(0));
    expect(t.segments).toEqual([]);
    expect(texte(ecrireGpx(t, []))).toBe(GPX_VIDE);
  });

  it('refuse un XML cassé ou étranger', () => {
    expect(lireGpx(new TextEncoder().encode('<gpx><trk>'))).toEqual({ ok: false, raison: 'xml' });
    expect(lireGpx(new TextEncoder().encode('<kml/>'))).toEqual({ ok: false, raison: 'pas_gpx' });
    expect(lireGpx(new Uint8Array([0xff, 0xfe, 0x3c]))).toEqual({ ok: false, raison: 'xml' });
  });
});

describe('réécriture des noms', () => {
  it.each(['aiguillette-des-houches.gpx', 'footing-canal.gpx', 'velo-sans-altitude.gpx'])(
    'rend %s à l’octet près tant que rien ne change',
    (nom) => {
      const o = exemple(nom);
      const t = lire(o);
      expect(Buffer.from(ecrireGpx(t, nomsDe(t)))).toEqual(Buffer.from(o));
    }
  );

  it('ne touche qu’au <name> changé, et garde les extensions', () => {
    const t = lire(exemple('aiguillette-des-houches.gpx'));
    const noms = nomsDe(t);
    noms[1] = 'Crête <sommet> & retour';
    const sortie = texte(ecrireGpx(t, noms));
    expect(sortie.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(sortie).toContain('<name>Crête &lt;sommet&gt; &amp; retour</name>');
    expect(sortie).toContain('<name>Montée par la forêt</name>');
    const relu = lire(new TextEncoder().encode(sortie));
    expect(nomsDe(relu)).toEqual(noms);
    expect(relu.segments.map((s) => s.points.length)).toEqual([161, 61, 171]);
    // Stable : relu puis réécrit sans changement, il ne bouge plus.
    expect(texte(ecrireGpx(relu, nomsDe(relu)))).toBe(sortie);
  });

  it('crée le <name> manquant en tête du <trk>, dans le bon espace de noms', () => {
    const t = lire(exemple('footing-canal.gpx'));
    const sortie = texte(ecrireGpx(t, ['Footing du jeudi']));
    expect(sortie).toMatch(/<trk>\s*<name>Footing du jeudi<\/name>\s*<type>running<\/type>/);
    expect(sortie).toContain('<gpxtpx:hr>');
    const relu = lire(new TextEncoder().encode(sortie));
    expect(relu.doc.documentElement.getElementsByTagNameNS('http://www.topografix.com/GPX/1/1', 'name')).toHaveLength(1);
    expect(nomsDe(relu)).toEqual(['Footing du jeudi']);
  });

  it('retire le <name> vidé, et nettoie les caractères de contrôle', () => {
    const t = lire(exemple('velo-sans-altitude.gpx'));
    expect(texte(ecrireGpx(t, ['']))).not.toContain('<name>');
    expect(nettoyerNom('a\u0000b\nc')).toBe('a b c');
  });
});

describe('fonctions pures', () => {
  it('vignette : un PNG du profil sous 96 Kio', () => {
    for (const nom of ['aiguillette-des-houches.gpx', 'velo-sans-altitude.gpx']) {
      const png = fonctions.thumbnail!(exemple(nom), ctx) as Uint8Array;
      expect([...png.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      expect(png.byteLength).toBeLessThanOrEqual(96 * 1024);
      const idat = png.indexOf(0x49, 33);
      expect(idat).toBeGreaterThan(0);
    }
  });

  it('fields : distance et dénivelé au type déclaré', () => {
    const f = fonctions.fields!(exemple('aiguillette-des-houches.gpx'), ctx) as Record<string, number>;
    const p = calculerProfil(lire(exemple('aiguillette-des-houches.gpx')).segments);
    expect(f.distance_km).toBeCloseTo(p.distanceM / 1000, 2);
    expect(f.denivele_m).toBe(Math.round(p.montee!));
    expect(f.denivele_m).toBeGreaterThan(1000);
    expect(fonctions.fields!(exemple('velo-sans-altitude.gpx'), ctx)).toMatchObject({ denivele_m: null });
  });

  it('extractText : les noms, sans doublon', () => {
    expect(fonctions.extractText!(exemple('aiguillette-des-houches.gpx'), ctx)).toBe(
      'Aiguillette des Houches par le Coupeau\nMontée par la forêt\nCrête & Aiguillette\nDescente sur le Coupeau'
    );
    expect(fonctions.extractText!(exemple('footing-canal.gpx'), ctx)).toBe('');
    expect(() => fonctions.extractText!(new TextEncoder().encode('<x'), ctx)).toThrow();
  });

  it('les pixels de la vignette se décompressent', () => {
    const png = fonctions.thumbnail!(exemple('aiguillette-des-houches.gpx'), ctx) as Uint8Array;
    const v = new DataView(png.buffer, png.byteOffset);
    let p = 8;
    let idat: Uint8Array | null = null;
    while (p < png.length) {
      const n = v.getUint32(p);
      if (String.fromCharCode(...png.slice(p + 4, p + 8)) === 'IDAT') idat = png.slice(p + 8, p + 8 + n);
      p += 12 + n;
    }
    expect(inflateSync(idat!).length).toBe(96 * 193);
  });
});
