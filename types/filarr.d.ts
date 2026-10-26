/**
 * filarr.d.ts — les types AMBIANTS de l'API `host`, pour les exemples avec code.
 *
 * Écrits champ par champ d'après la page bac à sable de Filarr
 * (`public/plugin-sandbox.html`, protocole version 2) et `docs/contract/API.md`.
 * Si un jour la page et ce fichier divergent, c'est la page qui a raison : elle
 * est ce qui exécute votre code.
 *
 * Pourquoi des types ambiants plutôt qu'un paquet : les exemples n'ont AUCUNE
 * dépendance. Ce fichier est inclus par le `tsconfig.json` de chaque exemple ;
 * il ne produit aucun code, il ne fait que décrire ce que la page fournit.
 *
 * Ce qui N'EXISTE PAS dans la page, et que ces types ne prétendent pas offrir :
 * aucun réseau direct (CSP `default-src 'none'`, `webrtc 'block'`), aucun
 * `localStorage` ni `indexedDB` (origine opaque : ils jettent), aucun
 * `alert`/`confirm`/`prompt` utilisable.
 */

/** Ce que la page accepte comme octets : elle en fait toujours une COPIE détachable. */
type FilarrBytes = Uint8Array | ArrayBuffer | string;

/** Le point d'entrée monté. `function` n'a pas de `host` : voir `FilarrFunctions`. */
type FilarrMode = 'editor' | 'block' | 'widget';

/** Le thème de l'hôte. Les jetons sont DÉJÀ posés en variables CSS sur `host.container`. */
interface FilarrTheme {
  scheme: 'light' | 'dark';
  /** `--color-*`, `--font-family-*`, `--radius-*` — 64 au plus, valeurs filtrées. */
  tokens: Record<string, string>;
}

/**
 * Les codes stables d'un rejet de `saveBytes` (API.md §3). Tout autre code est
 * une clé d'erreur de l'hôte (quota, hors ligne, session…) à afficher telle quelle.
 */
type FilarrSaveRejection = 'item_version_conflict' | 'read_only' | 'save_in_flight' | (string & {});

/** Capacité `storage` : octets chiffrés, LOCAUX à l'appareil, effacés à la désinstallation. */
interface FilarrStorage {
  /** `null` si la clé n'existe pas. Clés : `^[a-z0-9._-]{1,64}$`, 256 au plus. */
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, bytes: FilarrBytes): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Un fichier choisi par l'utilisateur dans le sélecteur de Filarr (capacité `picker`). */
interface FilarrPicked {
  /** Opaque, aléatoire, valable pour la SESSION et pour cette extension seulement. */
  handle: string;
  /** Le nom d'affichage du fichier — jamais un chemin. */
  name: string;
}

/** Capacité `network` : une requête, montrée à l'utilisateur avant de partir. */
interface FilarrNetworkRequest {
  /** `GET` par défaut. `GET`, `POST`, `PUT`, `PATCH`, `DELETE`. */
  method?: string;
  /** HTTPS, hôte EXACTEMENT dans `network.domains`, 2048 caractères au plus. */
  url: string;
  /** Mis en minuscules par la page. Jamais l'en-tête d'un secret déclaré. */
  headers?: Record<string, string>;
  /** 1 Mio au plus ; jamais sur un `GET`. */
  body?: FilarrBytes | null;
}

interface FilarrNetworkResponse {
  /** Le statut tel quel : un 404 est une réponse, pas un rejet. */
  status: number;
  contentType: string;
  /** 1 Mio au plus (au-delà : rejet `net_too_large`). */
  body: Uint8Array;
}

interface FilarrNetwork {
  /**
   * Rejette avec un CODE : `net_refused` (l'utilisateur a refusé ou bloqué),
   * `net_domain`, `net_header`, `net_invalid`, `net_redirect`, `net_unreachable`,
   * `net_too_large`, `busy` (quatre demandes en attente), `unavailable` (web :
   * pas de relais réseau), `rate_limited`, `too_many_requests`.
   */
  request(req: FilarrNetworkRequest): Promise<FilarrNetworkResponse>;
}

/**
 * Capacité `collab`, EN SALLE seulement (API.md §3). Des octets dans les deux
 * sens : l'extension tient SON `Y.Doc`, jamais celui de l'hôte.
 */
interface FilarrCollab {
  /** Vrai : la salle est vide et c'est CETTE page qui la sème depuis `initialBytes`. */
  readonly seed: boolean;
  /** Ce que la salle contient déjà, à appliquer avant tout. */
  readonly initialUpdates: Uint8Array[];
  /** L'élu qui enregistre pour la salle — décidé par l'hôte, jamais par l'extension. */
  isResponsible(): boolean;
  onResponsibleChange(cb: (responsible: boolean) => void): () => void;
  /** Les updates des autres. Celles arrivées avant l'abonnement sont rejouées. */
  onRemoteUpdate(cb: (bytes: Uint8Array) => void): () => void;
  /** 1 Mio au plus par update ; jette `read_only` en lecture seule. */
  sendUpdate(bytes: FilarrBytes): void;
  /** Une fois, juste après avoir semé une salle vide. */
  seeded(): void;
}

/** L'objet passé à `mount()` — miroir de ce que construit la page bac à sable. */
interface FilarrHost {
  readonly mode: FilarrMode;
  /** `#plugin-root`, plein cadre, fond transparent. Appartient à l'hôte. */
  readonly container: HTMLElement;
  /** Le nom d'affichage du fichier (ou de l'extension, en bloc et en widget). */
  readonly fileName: string;
  /** Obligation VÉRIFIÉE : `saveBytes` rejette `read_only` quand il est vrai. */
  readonly readOnly: boolean;
  /**
   * Les octets au montage. 0 octet = document neuf. En widget : le réglage du
   * bloc d'accueil en UTF-8 (240 caractères au plus). En bloc : les données du bloc.
   */
  readonly initialBytes: Uint8Array;
  /** La langue de Filarr (`fr`, `en`…), 35 caractères au plus. */
  readonly locale: string;
  readonly theme: FilarrTheme;
  /** Rend le désabonnement — à appeler dans `destroy()`. */
  onThemeChange(cb: (theme: FilarrTheme) => void): () => void;
  /** Le seul chemin d'écriture. Rejette avec un CODE (`FilarrSaveRejection`). */
  saveBytes(bytes: FilarrBytes): Promise<void>;
  /** `true` à CHAQUE mutation ; `false` seulement après un `saveBytes` réussi. */
  onDirty(dirty: boolean): void;
  /** Présent seulement avec la capacité `collab`, en mode éditeur, dans une salle. */
  readonly collab?: FilarrCollab;
  /** Présent seulement avec la capacité `storage`. */
  readonly storage?: FilarrStorage;
  /** Présents seulement avec la capacité `picker`. */
  readonly pick?: (opts?: { multiple?: boolean }) => Promise<FilarrPicked[]>;
  readonly readPicked?: (handle: string) => Promise<Uint8Array>;
  /** Présent seulement avec `picker: { access: 'readwrite' }`. */
  readonly writePicked?: (handle: string, bytes: FilarrBytes) => Promise<void>;
  /** Présent seulement avec la capacité `network` (bureau ; sur le web, `unavailable`). */
  readonly network?: FilarrNetwork;
}

/** Ce que `mount()` rend. */
interface FilarrEditorInstance {
  /** Synchrone. Libère TOUT ; ne lance aucune sauvegarde. */
  destroy(): void;
  /** Total et borné (10 s) : un rejet est un `fatal`, pas une erreur polie. */
  getBytes(): Uint8Array | Promise<Uint8Array>;
}

/** Un bloc de note ou un widget d'accueil : l'hôte ne demande jamais ses octets. */
interface FilarrMountedInstance {
  destroy(): void;
  getBytes?(): Uint8Array | Promise<Uint8Array>;
}

interface FilarrEditor {
  /** Pour une extension publiée : exactement `<id du manifeste>-editor`. */
  id: string;
  mount(host: FilarrHost): FilarrEditorInstance | Promise<FilarrEditorInstance>;
}

type FilarrExportTarget = 'md' | 'txt' | 'html' | 'csv' | 'json';

/** Le contexte d'un appel de fonction pure. */
interface FilarrFunctionContext {
  fileName: string;
  /** La cible, pour `export` seulement. */
  to?: FilarrExportTarget;
  locale: string;
}

type FilarrFieldValue = string | number | boolean | null;

/**
 * Les fonctions pures (capacité `functions`). Elles tournent dans une page
 * SANS aucune API — ni stockage, ni sélecteur, ni réseau — sur un fichier que
 * FILARR a choisi. 10 s par appel.
 *
 * ⚠ Le manifeste déclare `exports` ; le bundle expose `export` (le nom que
 * l'hôte appelle, `sandboxProtocol.ts`).
 */
interface FilarrFunctions {
  /** 100 000 caractères au plus (le reste est coupé). */
  extractText?(bytes: Uint8Array, ctx: FilarrFunctionContext): string | Promise<string>;
  /** PNG, JPEG ou WebP reconnu par ses octets, 96 Kio au plus. */
  thumbnail?(bytes: Uint8Array, ctx: FilarrFunctionContext): FilarrBytesResult | Promise<FilarrBytesResult>;
  /** Seules les clés DÉCLARÉES passent, chacune au type déclaré ; texte ≤ 500 caractères. */
  fields?(
    bytes: Uint8Array,
    ctx: FilarrFunctionContext
  ): Record<string, FilarrFieldValue> | Promise<Record<string, FilarrFieldValue>>;
  /** 64 Mio au plus. `ctx.to` dit la cible demandée. */
  export?(bytes: Uint8Array, ctx: FilarrFunctionContext): FilarrBytesResult | Promise<FilarrBytesResult>;
}

type FilarrBytesResult = Uint8Array | ArrayBuffer;

interface FilarrMountable {
  mount(host: FilarrHost): FilarrMountedInstance | Promise<FilarrMountedInstance>;
}

/** L'objet que le bundle IIFE pose sur `globalThis`. */
interface FilarrSandboxedPlugin {
  editors: FilarrEditor[];
  functions?: FilarrFunctions;
  /** Capacité `noteBlock` : `host.mode === 'block'`. */
  block?: FilarrMountable;
  /** Capacité `homeWidget` : `host.mode === 'widget'`, toujours en lecture seule. */
  widget?: FilarrMountable;
}

// La SEULE variable globale qu'un bundle pose.
// eslint-disable-next-line no-var
declare var filarrSandboxedPlugin: FilarrSandboxedPlugin | undefined;

/**
 * `import source from './calcul.worker.ts?worker'` : le build (`_outils/build.mjs`)
 * construit ce fichier à part, en IIFE, et l'importe comme TEXTE — de quoi créer
 * un Worker depuis un `blob:` (`worker-src blob:` est la seule source permise).
 */
declare module '*?worker' {
  const source: string;
  export default source;
}
