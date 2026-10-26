/**
 * page.mjs — une page bac à sable SIMULÉE, pour `check.mjs` et `smoke.mjs`.
 *
 * Ce module reproduit ce que fait `public/plugin-sandbox.html` (protocole
 * version 2) autour d'un bundle, dans jsdom :
 *
 *  - le bundle est exécuté par le `Function` DE LA PAGE
 *    (`new window.Function('globalThis', code)(window)`) : ses identifiants
 *    libres (`document`, `setTimeout`…) se résolvent dans la page, comme dans
 *    l'iframe, et non dans Node ;
 *  - `host` est construit champ par champ comme la page le construit, y
 *    compris les API ouvertes par les capacités (`withGrants`) et la
 *    co-édition (`makeCollab`, recopiée fidèlement) ;
 *  - ce que jsdom n'a pas et que l'iframe a (TextEncoder, Worker depuis un
 *    `blob:`, URL.createObjectURL, ResizeObserver, PointerEvent, matchMedia)
 *    est fourni ici, COMPTÉ : `destroy()` doit tout rendre ;
 *  - l'horloge est simulée : on avance de 2 s sans attendre 2 s, et l'on voit
 *    chaque minuteur qu'un exemple oublie d'annuler.
 *
 * Ce n'est PAS la page réelle : pas de CSP, pas d'origine opaque, pas de
 * MessagePort. Ce qui se vérifie ici, c'est le comportement de l'extension
 * face au contrat ; l'isolation, elle, se vérifie dans Filarr.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';

// ── Les bornes recopiées de la page et du protocole ─────────────────────────

const COLLAB_SEND_MAX = 1024 * 1024;
const COLLAB_QUEUE_MAX = 4096;
const STORAGE_KEY_RE = /^[a-z0-9._-]{1,64}$/;
const NET_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const NET_MAX_BODY_BYTES = 1024 * 1024;
const THEME_NAME = /^--[a-z0-9-]{1,48}$/;
const THEME_FORBIDDEN = /[;{}<>\\]|url\s*\(/i;

/** Deux thèmes plausibles, avec les jetons de `SANDBOX_THEME_TOKENS`. */
export const THEME_CLAIR = {
  scheme: 'light',
  tokens: {
    '--color-background': 'rgb(255, 255, 255)',
    '--color-background-secondary': 'rgb(246, 246, 247)',
    '--color-surface': 'rgb(255, 255, 255)',
    '--color-surface-hover': 'rgb(240, 240, 242)',
    '--color-border': 'rgb(220, 220, 224)',
    '--color-text-primary': 'rgb(26, 26, 30)',
    '--color-text-secondary': 'rgb(90, 90, 100)',
    '--color-primary-fill': 'rgb(59, 91, 219)',
    '--color-text-on-primary': 'rgb(255, 255, 255)',
    '--color-focus-ring': 'rgb(59, 91, 219)',
    '--color-error-on-background': 'rgb(190, 30, 45)',
    '--font-family-base': 'system-ui, sans-serif',
    '--radius-md': '8px',
  },
};
export const THEME_SOMBRE = {
  scheme: 'dark',
  tokens: {
    '--color-background': 'rgb(18, 18, 22)',
    '--color-background-secondary': 'rgb(28, 28, 34)',
    '--color-surface': 'rgb(30, 30, 36)',
    '--color-surface-hover': 'rgb(40, 40, 48)',
    '--color-border': 'rgb(60, 60, 70)',
    '--color-text-primary': 'rgb(236, 236, 240)',
    '--color-text-secondary': 'rgb(170, 170, 180)',
    '--color-primary-fill': 'rgb(120, 150, 255)',
    '--color-text-on-primary': 'rgb(10, 10, 20)',
    '--color-focus-ring': 'rgb(120, 150, 255)',
    '--color-error-on-background': 'rgb(255, 120, 120)',
    '--font-family-base': 'system-ui, sans-serif',
    '--radius-md': '8px',
  },
};

/** Laisse passer les microtâches et les messages en attente. */
export async function vider(tours = 12) {
  for (let i = 0; i < tours; i++) await new Promise((r) => setImmediate(r));
}

/** Une copie Node des octets, quel que soit leur royaume — comme `toBuffer` de la page. */
export function versOctets(v) {
  if (typeof v === 'string') return new Uint8Array(Buffer.from(v, 'utf8'));
  if (Object.prototype.toString.call(v) === '[object ArrayBuffer]') return new Uint8Array(v.slice(0));
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  if (v && typeof v.length === 'number') return Uint8Array.from(v);
  throw new Error('octets illisibles : ' + Object.prototype.toString.call(v));
}

export function memesOctets(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

// ── La page ─────────────────────────────────────────────────────────────────

export function creerPage() {
  const erreurs = [];
  const journal = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String(e?.message ?? e);
    // jsdom n'a pas de canvas : un exemple qui teste `getContext()` reçoit null.
    if (/Not implemented/i.test(m)) return;
    const detail = e?.detail?.stack ?? e?.detail ?? '';
    erreurs.push(detail ? `${m} — ${String(detail).split('\n').slice(0, 3).join(' | ')}` : m);
  });
  vc.on('error', (...a) => journal.push('console.error ' + a.map(String).join(' ')));
  vc.on('warn', (...a) => journal.push('console.warn ' + a.map(String).join(' ')));

  const dom = new JSDOM(
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>' +
      '<body><div id="plugin-root" style="position:fixed;inset:0"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc }
  );
  const w = dom.window;
  const compte = { urls: 0, workers: 0, observateurs: 0, mediaEcouteurs: 0 };

  // TextEncoder/TextDecoder : absents de jsdom, présents dans l'iframe. Les
  // tableaux rendus appartiennent au royaume de la page, comme là-bas.
  const enc = new TextEncoder();
  w.TextEncoder = class {
    get encoding() {
      return 'utf-8';
    }
    encode(s = '') {
      return new w.Uint8Array(enc.encode(String(s)));
    }
  };
  w.TextDecoder = TextDecoder;
  w.structuredClone = (v) => structuredClone(v);
  if (!w.crypto?.getRandomValues) w.crypto = globalThis.crypto;

  const horloge = installerHorloge(w, erreurs);

  // URL.createObjectURL : la seule façon de nourrir un Worker (`worker-src blob:`).
  const blobs = new Map();
  w.URL.createObjectURL = (blob) => {
    const url = `blob:null/${randomBytes(8).toString('hex')}`;
    blobs.set(url, blob);
    compte.urls++;
    return url;
  };
  w.URL.revokeObjectURL = (url) => {
    if (blobs.delete(String(url))) compte.urls--;
  };

  w.Worker = creerWorker(w, blobs, compte, erreurs);

  w.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.cibles = new Set();
    }
    observe(el) {
      if (this.cibles.size === 0) compte.observateurs++;
      this.cibles.add(el);
    }
    unobserve(el) {
      this.cibles.delete(el);
      if (this.cibles.size === 0) compte.observateurs--;
    }
    disconnect() {
      if (this.cibles.size > 0) compte.observateurs--;
      this.cibles.clear();
    }
  };

  w.matchMedia = (requete) => ({
    matches: false,
    media: String(requete),
    addEventListener: () => compte.mediaEcouteurs++,
    removeEventListener: () => compte.mediaEcouteurs--,
    addListener: () => compte.mediaEcouteurs++,
    removeListener: () => compte.mediaEcouteurs--,
  });

  // PointerEvent et la capture : présents dans tout navigateur cible.
  w.eval(`
    window.PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
        this.isPrimary = init.isPrimary ?? true;
        this.pressure = init.pressure ?? 0.5;
      }
    };
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
    Element.prototype.hasPointerCapture = function () { return false; };
  `);

  // Les écouteurs posés sur window et document : un exemple qui les oublie à
  // `destroy()` fuit d'une ouverture à l'autre.
  const ecouteurs = [];
  for (const cible of [w, w.document]) {
    const ajouter = cible.addEventListener.bind(cible);
    const retirer = cible.removeEventListener.bind(cible);
    const capture = (o) => (typeof o === 'boolean' ? o : !!o?.capture);
    cible.addEventListener = (type, fn, o) => {
      // jsdom et son moteur de sélecteurs posent eux-mêmes quelques écouteurs : seul compte
      // ce que pose le code de l'extension.
      const appelant = String(new Error().stack).split('\n')[2] ?? '';
      const interne = /node_modules[\\/](jsdom|nwsapi)[\\/]/.test(appelant);
      if (fn && !interne && !ecouteurs.some((e) => e.cible === cible && e.type === type && e.fn === fn && e.capture === capture(o))) {
        ecouteurs.push({ cible, type, fn, capture: capture(o) });
      }
      return ajouter(type, fn, o);
    };
    cible.removeEventListener = (type, fn, o) => {
      const i = ecouteurs.findIndex((e) => e.cible === cible && e.type === type && e.fn === fn && e.capture === capture(o));
      if (i >= 0) ecouteurs.splice(i, 1);
      return retirer(type, fn, o);
    };
  }

  const container = w.document.getElementById('plugin-root');

  return {
    window: w,
    container,
    horloge,
    erreurs,
    journal,
    compte,
    /** Le détail des écouteurs encore posés sur window et document. */
    get ecouteursPoses() {
      return ecouteurs.map((e) => `${e.cible === w ? "window" : "document"}:${e.type}`);
    },
    /** Ce qui reste vivant — tout doit valoir zéro après `destroy()`. */
    restes() {
      return {
        minuteurs: horloge.actifs,
        ecouteursFenetre: ecouteurs.length,
        urlsBlob: compte.urls,
        workers: compte.workers,
        observateurs: compte.observateurs,
        ecouteursMedia: compte.mediaEcouteurs,
      };
    },
    /** Exécute le bundle comme la page : `new Function('globalThis', code)(globalThis)`. */
    charger(code) {
      new w.Function('globalThis', code)(w);
      return w.filarrSandboxedPlugin;
    },
    fermer() {
      w.close();
    },
  };
}

function installerHorloge(w, erreurs) {
  let t = 0;
  let seq = 1;
  const file = new Map();
  const poser = (fn, ms, args, rep) => {
    if (typeof fn !== 'function') return 0;
    const id = seq++;
    file.set(id, { quand: t + Math.max(0, Number(ms) || 0), fn, args, rep });
    return id;
  };
  w.setTimeout = (fn, ms, ...args) => poser(fn, ms, args, null);
  w.setInterval = (fn, ms, ...args) => poser(fn, ms, args, Math.max(1, Number(ms) || 0));
  w.clearTimeout = (id) => {
    file.delete(id);
  };
  w.clearInterval = w.clearTimeout;
  w.requestAnimationFrame = (fn) => poser(() => fn(t), 16, [], null);
  w.cancelAnimationFrame = w.clearTimeout;
  return {
    get maintenant() {
      return t;
    },
    get actifs() {
      return file.size;
    },
    /** Avance de `ms` millisecondes, en exécutant chaque minuteur échu dans l'ordre. */
    async avancer(ms) {
      const fin = t + ms;
      for (;;) {
        let id = null;
        let m = null;
        for (const [i, x] of file) {
          if (x.quand <= fin && (m === null || x.quand < m.quand)) {
            id = i;
            m = x;
          }
        }
        if (m === null) break;
        t = m.quand;
        if (m.rep) m.quand = t + m.rep;
        else file.delete(id);
        try {
          m.fn(...m.args);
        } catch (e) {
          erreurs.push(`minuteur : ${e?.stack ?? e}`);
        }
        await vider();
      }
      t = fin;
      await vider();
    },
  };
}

/** Un Worker qui exécute VRAIMENT le code du `blob:`, dans un contexte à part. */
function creerWorker(w, blobs, compte, erreurs) {
  return class Worker {
    constructor(url) {
      const blob = blobs.get(String(url));
      if (!blob) throw new w.DOMException('Worker : seule une URL blob: est permise', 'SecurityError');
      compte.workers++;
      this.vivant = true;
      this.onmessage = null;
      this.onerror = null;
      this.ecouteurs = new Set();
      this.attente = [];
      this.portee = null;
      const lecteur = new w.FileReader();
      lecteur.onload = () => this.demarrer(String(lecteur.result));
      lecteur.readAsText(blob);
    }
    demarrer(source) {
      if (!this.vivant) return;
      const moi = this;
      const ecouteursPortee = new Set();
      const portee = {
        onmessage: null,
        postMessage(d) {
          const copie = structuredClone(d);
          setImmediate(() => moi.recevoir(copie));
        },
        addEventListener(type, fn) {
          if (type === 'message') ecouteursPortee.add(fn);
        },
        removeEventListener(type, fn) {
          if (type === 'message') ecouteursPortee.delete(fn);
        },
        close() {},
        console,
      };
      portee.self = portee;
      portee.__ecouteurs = ecouteursPortee;
      try {
        vm.runInContext(source, vm.createContext(portee));
      } catch (e) {
        erreurs.push(`worker : ${e?.stack ?? e}`);
        return;
      }
      this.portee = portee;
      for (const d of this.attente) this.livrer(d);
      this.attente = [];
    }
    livrer(d) {
      const ev = { data: d };
      try {
        this.portee.onmessage?.(ev);
        for (const fn of this.portee.__ecouteurs) fn(ev);
      } catch (e) {
        erreurs.push(`worker : ${e?.stack ?? e}`);
        this.onerror?.({ message: String(e?.message ?? e) });
      }
    }
    recevoir(d) {
      if (!this.vivant) return;
      const ev = { data: d };
      this.onmessage?.(ev);
      for (const fn of this.ecouteurs) fn(ev);
    }
    postMessage(d) {
      if (!this.vivant) return;
      const copie = structuredClone(d);
      setImmediate(() => {
        if (!this.vivant) return;
        if (this.portee) this.livrer(copie);
        else this.attente.push(copie);
      });
    }
    addEventListener(type, fn) {
      if (type === 'message') this.ecouteurs.add(fn);
    }
    removeEventListener(type, fn) {
      if (type === 'message') this.ecouteurs.delete(fn);
    }
    terminate() {
      if (!this.vivant) return;
      this.vivant = false;
      compte.workers--;
    }
  };
}

// ── L'hôte ──────────────────────────────────────────────────────────────────

function appliquerTheme(container, theme, precedent) {
  for (const nom of Object.keys(precedent?.tokens ?? {})) container.style.removeProperty(nom);
  const propre = { scheme: theme?.scheme === 'dark' ? 'dark' : 'light', tokens: {} };
  for (const [k, v] of Object.entries(theme?.tokens ?? {})) {
    if (!THEME_NAME.test(k) || typeof v !== 'string' || v.length > 80 || THEME_FORBIDDEN.test(v)) continue;
    container.style.setProperty(k, v);
    propre.tokens[k] = v;
  }
  container.style.colorScheme = propre.scheme;
  return propre;
}

/** Une poignée de sélecteur : 24 caractères aléatoires, comme celles de Filarr. */
function nouvellePoignee() {
  return randomBytes(18).toString('base64url');
}

/**
 * Le `host` d'une page, construit comme `onInit` de `plugin-sandbox.html`.
 *
 * Options : `octets`, `nomFichier`, `lectureSeule`, `langue`, `mode`, `theme`,
 * `capacites` (les capacités ACCORDÉES), `collab` (`{ seed, responsible,
 * updates }`), `stockage` (une Map partagée entre pages), `selection`
 * (`[{ name, octets }]`), `reseau` (`(req) => Promise<réponse>` ou rejet).
 */
export function creerHote(page, o = {}) {
  const w = page.window;
  const capacites = o.capacites ?? {};
  const lectureSeule = !!o.lectureSeule;
  const mode = o.mode ?? 'editor';
  let theme = appliquerTheme(page.container, o.theme ?? THEME_CLAIR, null);
  const traces = {
    enregistrements: [],
    sales: [],
    envois: [],
    semis: 0,
    requetesReseau: [],
    fautes: [],
  };
  const ecouteursTheme = [];
  let repondre = () => null;

  const host = {
    mode,
    container: page.container,
    fileName: String(o.nomFichier ?? 'document'),
    readOnly: lectureSeule,
    initialBytes: new w.Uint8Array(o.octets ?? new Uint8Array(0)),
    locale: String(o.langue ?? 'fr').slice(0, 35),
    get theme() {
      return theme;
    },
    onThemeChange(cb) {
      if (typeof cb !== 'function') return () => {};
      ecouteursTheme.push(cb);
      return () => {
        const i = ecouteursTheme.indexOf(cb);
        if (i >= 0) ecouteursTheme.splice(i, 1);
      };
    },
    saveBytes(bytes) {
      const copie = versOctets(bytes);
      traces.enregistrements.push(copie);
      return new w.Promise((resolve, reject) => {
        setImmediate(() => {
          // L'hôte refuse structurellement en lecture seule (API.md §3).
          const code = lectureSeule ? 'read_only' : repondre(copie);
          if (code) reject(new w.Error(code));
          else resolve();
        });
      });
    },
    onDirty(d) {
      traces.sales.push(!!d);
    },
  };

  let collab;
  if (mode === 'editor' && capacites.collab === true && o.collab) {
    collab = creerCollab(w, o.collab, lectureSeule, traces);
    host.collab = collab.api;
  }

  if (capacites.storage) {
    const magasin = o.stockage ?? new Map();
    const verifierCle = (key) => {
      if (!STORAGE_KEY_RE.test(key)) {
        traces.fautes.push(`clé de stockage invalide « ${key} » (^[a-z0-9._-]{1,64}$)`);
        return false;
      }
      return true;
    };
    host.storage = {
      get: (key) =>
        new w.Promise((res, rej) => {
          key = String(key);
          if (!verifierCle(key)) return rej(new w.Error('capability_denied'));
          const v = magasin.get(key);
          res(v ? new w.Uint8Array(v) : null);
        }),
      set: (key, bytes) =>
        new w.Promise((res, rej) => {
          key = String(key);
          if (!verifierCle(key)) return rej(new w.Error('capability_denied'));
          const copie = versOctets(bytes);
          let total = copie.byteLength;
          for (const [k, v] of magasin) if (k !== key) total += v.byteLength;
          if (total > capacites.storage.quota) return rej(new w.Error('quota_exceeded'));
          if (!magasin.has(key) && magasin.size >= 256) return rej(new w.Error('too_many_keys'));
          magasin.set(key, copie);
          res();
        }),
      delete: (key) =>
        new w.Promise((res, rej) => {
          key = String(key);
          if (!verifierCle(key)) return rej(new w.Error('capability_denied'));
          magasin.delete(key);
          res();
        }),
      keys: () => w.Promise.resolve(w.Array.from(magasin.keys())),
    };
  }

  if (capacites.picker) {
    const poignees = new Map();
    host.pick = (opts) =>
      new w.Promise((res) => {
        const choix = (o.selection ?? []).slice(0, opts?.multiple ? undefined : 1);
        res(
          w.Array.from(
            choix.map((f) => {
              const handle = nouvellePoignee();
              poignees.set(handle, f);
              return { handle, name: f.name };
            })
          )
        );
      });
    host.readPicked = (handle) =>
      new w.Promise((res, rej) => {
        const f = poignees.get(String(handle));
        if (!f) return rej(new w.Error('unknown_handle'));
        res(new w.Uint8Array(f.octets));
      });
    if (capacites.picker.access === 'readwrite') {
      host.writePicked = (handle, bytes) =>
        new w.Promise((res, rej) => {
          const f = poignees.get(String(handle));
          if (!f) return rej(new w.Error('unknown_handle'));
          f.octets = versOctets(bytes);
          res();
        });
    }
  }

  if (capacites.network) {
    const grant = capacites.network;
    const reserves = new Set((grant.secrets ?? []).map((s) => s.header));
    host.network = {
      request(r) {
        r = r || {};
        const method = String(r.method || 'GET').toUpperCase();
        const url = String(r.url || '');
        const headers = {};
        for (const [k, v] of Object.entries(r.headers ?? {})) headers[String(k).toLowerCase()] = String(v);
        const body = r.body === undefined || r.body === null ? null : versOctets(r.body);
        return new w.Promise((res, rej) => {
          // Le jugement de l'hôte, avant toute requête (CAPABILITIES.md, palier 4).
          let code = null;
          let hote = '';
          try {
            const u = new URL(url);
            hote = u.hostname;
            if (u.protocol !== 'https:' || u.port || u.username || u.password) code = 'net_domain';
          } catch {
            code = 'net_invalid';
          }
          if (!code && !NET_METHODS.includes(method)) code = 'net_invalid';
          if (!code && method === 'GET' && body && body.byteLength > 0) code = 'net_invalid';
          if (!code && body && body.byteLength > NET_MAX_BODY_BYTES) code = 'net_invalid';
          if (!code && !grant.domains.includes(hote)) code = 'net_domain';
          if (!code && Object.keys(headers).some((h) => reserves.has(h) || !/^[a-z0-9-]{1,40}$/.test(h))) code = 'net_header';
          traces.requetesReseau.push({ method, url, headers, body });
          if (code) {
            traces.fautes.push(`requête refusée par l'hôte (${code}) : ${method} ${url}`);
            return rej(new w.Error(code));
          }
          const repondeur = o.reseau ?? (() => Promise.reject(new Error('unavailable')));
          Promise.resolve()
            .then(() => repondeur({ method, url, headers, body }))
            .then(
              (v) =>
                setImmediate(() =>
                  res({ status: v.status, contentType: v.contentType ?? '', body: new w.Uint8Array(versOctets(v.body ?? '')) })
                ),
              (e) => setImmediate(() => rej(new w.Error(String(e?.message ?? e))))
            );
        });
      },
    };
  }

  return {
    host,
    traces,
    collab,
    /** `(octets) => code | null` : le code avec lequel l'hôte rejettera la prochaine sauvegarde. */
    definirReponse(fn) {
      repondre = fn;
    },
    changerTheme(t) {
      theme = appliquerTheme(page.container, t, theme);
      for (const cb of [...ecouteursTheme]) cb(theme);
    },
    get ecouteursTheme() {
      return ecouteursTheme.length;
    },
  };
}

/** `makeCollab` de `plugin-sandbox.html`, à l'identique, plus des traces. */
function creerCollab(w, init, readOnly, traces) {
  let responsible = !!init.responsible;
  const collabListeners = [];
  let collabQueue = [];
  const responsibleListeners = [];
  let aSeme = false;
  const deja = (init.updates ?? []).map((u) => new w.Uint8Array(u));
  const retirer = (liste, cb) => () => {
    const j = liste.indexOf(cb);
    if (j >= 0) liste.splice(j, 1);
  };
  const api = {
    seed: !!init.seed,
    initialUpdates: w.Array.from(deja),
    isResponsible: () => responsible,
    onResponsibleChange(cb) {
      if (typeof cb !== 'function') return () => {};
      responsibleListeners.push(cb);
      return retirer(responsibleListeners, cb);
    },
    onRemoteUpdate(cb) {
      if (typeof cb !== 'function') return () => {};
      collabListeners.push(cb);
      const attente = collabQueue;
      collabQueue = [];
      for (const u of attente) cb(u);
      return retirer(collabListeners, cb);
    },
    sendUpdate(bytes) {
      if (readOnly) {
        traces.fautes.push('sendUpdate en lecture seule (la page jette read_only)');
        throw new w.Error('read_only');
      }
      const copie = versOctets(bytes);
      if (copie.byteLength === 0) return;
      if (copie.byteLength > COLLAB_SEND_MAX) throw new w.Error('collab_update_too_large');
      traces.envois.push(copie);
    },
    seeded() {
      if (!init.seed || aSeme) {
        if (!init.seed) traces.fautes.push('seeded() appelé par une page qui ne devait pas semer');
        return;
      }
      aSeme = true;
      traces.semis++;
    },
  };
  return {
    api,
    /** Une update d'un autre pair (`collab-update`). */
    livrer(octets) {
      const u = new w.Uint8Array(octets);
      if (collabListeners.length === 0) {
        if (collabQueue.length < COLLAB_QUEUE_MAX) collabQueue.push(u);
        return;
      }
      for (const cb of [...collabListeners]) cb(u);
    },
    /** `collab-state` : l'élu a changé. */
    definirResponsable(r) {
      responsible = !!r;
      for (const cb of [...responsibleListeners]) cb(responsible);
    },
    get ecouteurs() {
      return collabListeners.length + responsibleListeners.length;
    },
  };
}
