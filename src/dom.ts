/**
 * dom — construire l'interface SANS jamais interpréter de HTML.
 *
 * Le contenu d'un document est hostile par principe : un coffre partagé peut
 * contenir le fichier fabriqué par quelqu'un d'autre. Tout passe donc par
 * `createElement` et `textContent` ; aucune chaîne n'est jamais lue comme du
 * balisage. Ce module est recopié dans chaque exemple.
 */

type Enfant = Node | string | null | undefined | false;

export interface Proprietes {
  classe?: string;
  texte?: string;
  /** Attributs posés tels quels (`aria-*`, `role`, `type`…) — des chaînes, jamais du HTML. */
  attrs?: Record<string, string | number | boolean | undefined>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  p: Proprietes = {},
  enfants: Enfant[] = []
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (p.classe) e.className = p.classe;
  if (p.texte !== undefined) e.textContent = p.texte;
  poser(e, p.attrs);
  for (const c of enfants) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  enfants: Enfant[] = []
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  poser(e, attrs);
  for (const c of enfants) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

function poser(e: Element, attrs: Proprietes['attrs']): void {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === false) continue;
    e.setAttribute(k, v === true ? '' : String(v));
  }
}

/** Une feuille de style CONSTANTE (jamais construite avec des données du document). */
export function feuille(css: string): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = css;
  return s;
}

/**
 * Les écouteurs posés HORS de notre arbre (window, document) ne partent pas
 * avec lui : on les note pour tout retirer à `destroy()`.
 */
export interface Ecouteurs {
  sur<T extends EventTarget>(cible: T, type: string, fn: (e: Event) => void, options?: AddEventListenerOptions): void;
  tout(): void;
}

export function creerEcouteurs(): Ecouteurs {
  const poses: [EventTarget, string, (e: Event) => void, AddEventListenerOptions | undefined][] = [];
  return {
    sur(cible, type, fn, options) {
      cible.addEventListener(type, fn, options);
      poses.push([cible, type, fn, options]);
    },
    tout() {
      for (const [cible, type, fn, options] of poses.splice(0)) cible.removeEventListener(type, fn, options);
    },
  };
}

/** Ctrl+S / Cmd+S. */
export function estRaccourciEnregistrer(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's';
}
