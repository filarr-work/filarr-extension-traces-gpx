/**
 * png — un encodeur PNG minimal, PUR, et une toile de pixels indexés.
 *
 * Pourquoi l'écrire plutôt qu'utiliser `<canvas>` : la vignette est produite
 * par une FONCTION PURE (`functions.thumbnail`), dans une page que Filarr
 * ouvre sans rien afficher. Un encodeur sans DOM se teste dans Node, rend les
 * mêmes octets partout, et ne dépend d'aucun moteur de rendu.
 *
 * Le choix du format : couleurs indexées (une palette de 256 au plus, un
 * octet par pixel) et blocs deflate STOCKÉS (non compressés). Une vignette de
 * 160 × 120 fait ainsi environ 19 Kio — sous le plafond de 96 Kio de l'hôte,
 * sans embarquer de compresseur.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(octets: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(octets: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < octets.length; i++) {
    a = (a + octets[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Un flux zlib fait de blocs deflate stockés (RFC 1950/1951), 65 535 octets au plus chacun. */
function zlibStocke(donnees: Uint8Array): Uint8Array {
  const BLOC = 65535;
  const n = Math.max(1, Math.ceil(donnees.length / BLOC));
  const out = new Uint8Array(2 + n * 5 + donnees.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let p = 2;
  for (let i = 0; i < n; i++) {
    const morceau = donnees.subarray(i * BLOC, Math.min(donnees.length, (i + 1) * BLOC));
    out[p++] = i === n - 1 ? 1 : 0;
    out[p++] = morceau.length & 0xff;
    out[p++] = morceau.length >>> 8;
    out[p++] = ~morceau.length & 0xff;
    out[p++] = (~morceau.length >>> 8) & 0xff;
    out.set(morceau, p);
    p += morceau.length;
  }
  const a = adler32(donnees);
  out[p++] = a >>> 24;
  out[p++] = (a >>> 16) & 0xff;
  out[p++] = (a >>> 8) & 0xff;
  out[p++] = a & 0xff;
  return out;
}

function morceau(type: string, donnees: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + donnees.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, donnees.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(donnees, 8);
  v.setUint32(8 + donnees.length, crc32(out.subarray(4, 8 + donnees.length)));
  return out;
}

export type Rvb = [number, number, number];

/** Encode une image indexée : `pixels[y * largeur + x]` est un indice dans `palette`. */
export function encoderPngIndexe(largeur: number, hauteur: number, palette: Rvb[], pixels: Uint8Array): Uint8Array {
  if (palette.length < 1 || palette.length > 256) throw new Error('palette de 1 à 256 couleurs');
  if (pixels.length !== largeur * hauteur) throw new Error('nombre de pixels incohérent');
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, largeur);
  v.setUint32(4, hauteur);
  ihdr[8] = 8; // 8 bits par indice
  ihdr[9] = 3; // couleurs indexées
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach(([r, g, b], i) => plte.set([r, g, b], i * 3));
  // Chaque ligne commence par l'octet de filtre 0 (aucun filtre).
  const brut = new Uint8Array(hauteur * (largeur + 1));
  for (let y = 0; y < hauteur; y++) brut.set(pixels.subarray(y * largeur, (y + 1) * largeur), y * (largeur + 1) + 1);
  const parties = [
    Uint8Array.from(SIGNATURE),
    morceau('IHDR', ihdr),
    morceau('PLTE', plte),
    morceau('IDAT', zlibStocke(brut)),
    morceau('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parties.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const partie of parties) {
    out.set(partie, p);
    p += partie.length;
  }
  return out;
}

/** `#rrggbb` → [r, g, b] ; tout le reste → `repli`. */
export function rvbDe(hex: string, repli: Rvb = [0, 0, 0]): Rvb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : repli;
}

/** Une toile de pixels indexés, avec de quoi tracer des traits épais. */
export class Toile {
  readonly pixels: Uint8Array;
  private readonly palette: Rvb[] = [];
  private readonly indices = new Map<string, number>();

  constructor(
    readonly largeur: number,
    readonly hauteur: number,
    fond: Rvb
  ) {
    this.pixels = new Uint8Array(largeur * hauteur);
    this.indice(fond);
  }

  /** L'indice d'une couleur, ajoutée à la palette au besoin (la plus proche au-delà de 256). */
  indice(c: Rvb): number {
    const cle = c.join(',');
    const deja = this.indices.get(cle);
    if (deja !== undefined) return deja;
    if (this.palette.length < 256) {
      this.palette.push(c);
      this.indices.set(cle, this.palette.length - 1);
      return this.palette.length - 1;
    }
    let meilleur = 0;
    let distance = Infinity;
    this.palette.forEach((p, i) => {
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d < distance) {
        distance = d;
        meilleur = i;
      }
    });
    return meilleur;
  }

  /** Un disque plein — le « tampon » d'un trait épais. */
  disque(cx: number, cy: number, rayon: number, i: number): void {
    const r = Math.max(0.5, rayon);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.largeur - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.hauteur - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.pixels[y * this.largeur + x] = i;
      }
    }
  }

  /** Un segment épais : des disques tous les demi-pixels. */
  segment(xa: number, ya: number, xb: number, yb: number, rayon: number, i: number): void {
    const n = Math.max(1, Math.ceil(Math.hypot(xb - xa, yb - ya) * 2));
    for (let k = 0; k <= n; k++) this.disque(xa + ((xb - xa) * k) / n, ya + ((yb - ya) * k) / n, rayon, i);
  }

  /** Remplit une colonne de `yHaut` jusqu'en bas — le dessous d'une courbe. */
  colonne(x: number, yHaut: number, i: number): void {
    if (x < 0 || x >= this.largeur) return;
    for (let y = Math.max(0, Math.round(yHaut)); y < this.hauteur; y++) this.pixels[y * this.largeur + x] = i;
  }

  png(): Uint8Array {
    return encoderPngIndexe(this.largeur, this.hauteur, this.palette, this.pixels);
  }
}
