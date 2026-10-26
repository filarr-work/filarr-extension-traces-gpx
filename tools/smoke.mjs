#!/usr/bin/env node
/**
 * smoke.mjs — monte VRAIMENT l'éditeur d'un exemple, dans une page simulée
 * (`page.mjs`), et vérifie ce que le contrat exige de lui.
 *
 *   node ../_outils/smoke.mjs            (depuis le dossier d'un exemple, après build)
 *
 * Le bundle est chargé comme la page le charge (`new Function('globalThis',
 * code)(window)`, le `Function` de la page), puis monté avec un faux `host`
 * construit comme celui de `plugin-sandbox.html`. Rien ne part sur le réseau :
 * les réponses sont lues dans `smoke.json`.
 *
 * Les scénarios, pour chaque fichier de `exemples/` :
 *
 *  - aller-retour : `getBytes()` après montage, remonté, redonne les MÊMES
 *    octets ; et aucune sauvegarde n'est lancée à l'ouverture ;
 *  - fichier vide = document neuf ; fichier illisible = erreur affichée et
 *    octets d'origine rendus intacts (jamais d'écrasement silencieux) ;
 *  - lecture seule : champs figés ; après avoir cliqué TOUS les boutons et
 *    tapé partout, ni `saveBytes`, ni `onDirty(true)`, ni octets changés ;
 *  - édition (étapes de `smoke.json`) : `onDirty(true)`, rien avant 2 s, une
 *    sauvegarde après, `onDirty(false)` au succès ; puis les rejets
 *    `item_version_conflict` (alerte, loquet levé par Ctrl+S), `save_in_flight`
 *    (silencieux, réessayé), `read_only` et un code inconnu (alerte) ;
 *  - langue : l'interface diffère entre `fr` et `en` ;
 *  - thème : `onThemeChange` notifié sans erreur ;
 *  - `destroy()` : conteneur vidé, zéro minuteur, écouteur de fenêtre, URL
 *    `blob:`, worker, observateur, abonnement au thème ou à la salle.
 *
 * Et selon les capacités : fonctions pures (formes que l'hôte accepte, mêmes
 * bornes que `readCallValue`), bloc de note, widget d'accueil, co-édition à
 * deux pages et un lecteur (semis unique, convergence, seul l'élu enregistre).
 *
 * `smoke.json` (facultatif) :
 *   { "edition": [étape…], "bloc": { "fichier", "edition": [étape…] },
 *     "widget": { "config": "…" }, "reseau": [{ "prefixe", "statut", "type", "fichier" | "corps" }],
 *     "selection": ["exemples/…"] }
 * Étapes : { "saisir": sélecteur, "valeur" } (« {n} » = numéro de passage),
 * { "cliquer": sélecteur }, { "touche": sélecteur?, "cle", "ctrl"?, "shift"?, "alt"? },
 * { "pointeur": sélecteur, "trace": [[x, y]…] }, { "attendre": ms }.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dossierExemple } from './build.mjs';
import { THEME_SOMBRE, creerHote, creerPage, memesOctets, versOctets, vider } from './page.mjs';

const DELAI_MIN_MS = 2000;
const EXTRACT_MAX = 100_000;
const THUMB_MAX = 96 * 1024;
const FIELD_TEXT_MAX = 500;

const resultats = [];
let passage = 0;

class Echec extends Error {}
const exiger = (cond, message) => {
  if (!cond) throw new Echec(message);
};

async function scenario(nom, fn) {
  try {
    const note = await fn();
    resultats.push({ nom, ok: true, note });
  } catch (e) {
    resultats.push({ nom, ok: false, note: e instanceof Echec ? e.message : e?.stack ?? String(e) });
  }
}

// ── Les outils de scénario ──────────────────────────────────────────────────

function lireTout(dossier) {
  const out = [];
  if (!existsSync(dossier)) return out;
  for (const nom of readdirSync(dossier)) {
    const p = join(dossier, nom);
    if (statSync(p).isDirectory()) out.push(...lireTout(p));
    else out.push(p);
  }
  return out;
}

function racineDe(page) {
  const actif = page.window.document.activeElement;
  if (actif && actif !== page.window.document.body && page.container.contains(actif)) return actif;
  return [...page.container.children].find((e) => e.tagName !== 'STYLE') ?? page.container;
}

/** Le texte que l'on voit : sans les feuilles de style posées dans le conteneur. */
function texteVisible(page) {
  return [...page.container.children]
    .filter((e) => e.tagName !== 'STYLE')
    .map((e) => e.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function alertes(page) {
  return [...page.container.querySelectorAll('[role="alert"]')]
    .filter((e) => !e.hidden && !e.closest('[hidden]') && e.textContent.trim() !== '')
    .map((e) => e.textContent.trim());
}

async function jouer(page, etapes, { tolerant = false } = {}) {
  const w = page.window;
  passage++;
  const trouver = (sel) => {
    const el = sel ? page.container.querySelector(sel) : racineDe(page);
    if (!el && !tolerant) throw new Echec(`étape : « ${sel} » introuvable`);
    return el;
  };
  for (const e of etapes ?? []) {
    if (e.saisir !== undefined) {
      const el = trouver(e.saisir);
      if (!el || el.disabled || el.readOnly) {
        if (!tolerant) throw new Echec(`étape : « ${e.saisir} » n'est pas modifiable`);
        continue;
      }
      el.focus();
      el.value = String(e.valeur ?? '').replace(/\{n\}/g, String(passage));
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    } else if (e.cliquer !== undefined) {
      const el = trouver(e.cliquer);
      if (!el || el.disabled) {
        if (!tolerant) throw new Echec(`étape : « ${e.cliquer} » n'est pas cliquable`);
        continue;
      }
      el.click();
    } else if (e.touche !== undefined || e.cle !== undefined) {
      const el = trouver(e.touche);
      if (!el) continue;
      el.focus?.();
      const init = { key: e.cle, bubbles: true, cancelable: true, ctrlKey: !!e.ctrl, shiftKey: !!e.shift, altKey: !!e.alt };
      el.dispatchEvent(new w.KeyboardEvent('keydown', init));
      el.dispatchEvent(new w.KeyboardEvent('keyup', init));
    } else if (e.pointeur !== undefined) {
      const el = trouver(e.pointeur);
      if (!el) continue;
      const trace = e.trace ?? [[10, 10]];
      const ev = (type, [x, y]) =>
        new w.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
      el.dispatchEvent(ev('pointerdown', trace[0]));
      for (const pt of trace.slice(1)) el.dispatchEvent(ev('pointermove', pt));
      el.dispatchEvent(ev('pointerup', trace[trace.length - 1]));
    } else if (e.attendre !== undefined) {
      await page.horloge.avancer(Number(e.attendre));
    }
    await vider();
  }
}

/** Monte une page : rend { page, hote, instance, plugin }. */
async function monter(code, manifeste, o) {
  const page = creerPage();
  const plugin = page.charger(code);
  const hote = creerHote(page, { capacites: manifeste.capabilities ?? {}, ...o });
  const mode = o.mode ?? 'editor';
  let entree;
  if (mode === 'editor') entree = plugin.editors.find((e) => e.id === `${manifeste.id}-editor`);
  else entree = mode === 'block' ? plugin.block : plugin.widget;
  exiger(entree && typeof entree.mount === 'function', `point d'entrée ${mode} absent`);
  let instance;
  try {
    instance = await entree.mount(hote.host);
  } catch (e) {
    page.fermer();
    throw new Echec(`mount() a rejeté : ${e?.message ?? e}`);
  }
  await vider();
  exiger(instance && typeof instance.destroy === 'function', 'mount() doit rendre une instance avec destroy()');
  if (mode === 'editor') exiger(typeof instance.getBytes === 'function', "l'instance d'éditeur doit avoir getBytes()");
  return { page, hote, instance, plugin };
}

async function octetsDe(m) {
  const v = await m.instance.getBytes();
  return versOctets(v);
}

/** `destroy()` doit TOUT rendre. */
async function detruire(m, quoi = 'destroy') {
  m.instance.destroy();
  await vider();
  const r = m.page.restes();
  const fuites = Object.entries(r).filter(([, n]) => n !== 0).map(([k, n]) => `${k}=${n}`);
  if (m.hote.ecouteursTheme) fuites.push(`abonnementsTheme=${m.hote.ecouteursTheme}`);
  if (m.hote.collab?.ecouteurs) fuites.push(`abonnementsSalle=${m.hote.collab.ecouteurs}`);
  if (m.page.container.childNodes.length) fuites.push(`noeudsDansLeConteneur=${m.page.container.childNodes.length}`);
  const erreurs = [...m.page.erreurs, ...m.hote.traces.fautes];
  m.page.fermer();
  exiger(fuites.length === 0, `${quoi} laisse des restes : ${fuites.join(', ')}`);
  exiger(erreurs.length === 0, `erreurs pendant la vie de la page : ${erreurs.join(' ; ')}`);
}

// ── Les scénarios d'éditeur ─────────────────────────────────────────────────

async function scenariosEditeur(dossier, code, m, fixtures, exemples) {
  const natives = m.extensions;
  const imports = m.capabilities?.imports ?? [];

  for (const f of exemples) {
    const ext = extname(f).slice(1).toLowerCase();
    const nom = relative(dossier, f).replace(/\\/g, '/');
    const octets = new Uint8Array(readFileSync(f));
    await scenario(`aller-retour ${nom}`, async () => {
      const a = await monter(code, m, { octets, nomFichier: basename(f) });
      exiger(alertes(a.page).length === 0, `alerte à l'ouverture d'un exemple valide : ${alertes(a.page).join(' | ')}`);
      const b1 = await octetsDe(a);
      await a.page.horloge.avancer(3000);
      exiger(a.hote.traces.enregistrements.length === 0, "saveBytes appelé à l'ouverture, sans modification");
      exiger(!a.hote.traces.sales.includes(true), "onDirty(true) à l'ouverture, sans modification");
      a.hote.changerTheme(THEME_SOMBRE);
      await vider();
      await detruire(a);
      const nomNatif = imports.includes(ext) ? basename(f, extname(f)) + '.' + natives[0] : basename(f);
      const b = await monter(code, m, { octets: b1, nomFichier: nomNatif });
      const b2 = await octetsDe(b);
      await detruire(b);
      exiger(memesOctets(b1, b2), 'getBytes() instable : remonté sur ses propres octets, il rend autre chose');
      if (imports.includes(ext)) return `importé depuis .${ext}, réécrit en .${natives[0]} (${b1.byteLength} o)`;
      return memesOctets(octets, b1) ? "identique à l'octet" : `normalisé (${octets.byteLength} → ${b1.byteLength} o), stable ensuite`;
    });
  }

  await scenario('fichier vide = document neuf', async () => {
    const a = await monter(code, m, { octets: new Uint8Array(0), nomFichier: `nouveau.${natives[0]}` });
    exiger(alertes(a.page).length === 0, `alerte sur un fichier vide : ${alertes(a.page).join(' | ')}`);
    const b1 = await octetsDe(a);
    await a.page.horloge.avancer(3000);
    exiger(a.hote.traces.enregistrements.length === 0, "saveBytes appelé à l'ouverture d'un document neuf");
    await detruire(a);
    const b = await monter(code, m, { octets: b1, nomFichier: `nouveau.${natives[0]}` });
    const b2 = await octetsDe(b);
    await detruire(b);
    exiger(memesOctets(b1, b2), 'le document neuf ne se relit pas à l’identique');
    return `${b1.byteLength} o`;
  });

  await scenario('fichier illisible', async () => {
    const poison = new Uint8Array([0xff, 0xfe, 0x00, 0x7b, 0x22, 0x5c, 0x00, 0xc3, 0x28, 0x3c, 0x21, 0x2d]);
    const a = await monter(code, m, { octets: poison, nomFichier: `casse.${natives[0]}` });
    const vues = alertes(a.page);
    const b1 = await octetsDe(a);
    await a.page.horloge.avancer(3000);
    exiger(a.hote.traces.enregistrements.length === 0, "saveBytes appelé sur un fichier qu'il n'a pas compris");
    await detruire(a);
    if (vues.length === 0) return 'accepté comme contenu valide';
    exiger(memesOctets(poison, b1), "fichier refusé mais getBytes() ne rend pas les octets d'origine : la fermeture l'écraserait");
    return `refusé avec une alerte (« ${vues[0].slice(0, 60)} »), octets d'origine rendus`;
  });

  const premier = exemples.find((f) => natives.includes(extname(f).slice(1).toLowerCase()));
  if (!premier) return;
  const octets = new Uint8Array(readFileSync(premier));
  const nomFichier = basename(premier);

  await scenario('lecture seule', async () => {
    const a = await monter(code, m, { octets, nomFichier, lectureSeule: true, selection: selectionDe(dossier, fixtures), reseau: reseauDe(dossier, fixtures) });
    const avant = await octetsDe(a);
    const w = a.page.window;
    const champs = [...a.page.container.querySelectorAll('textarea, input, select')].filter(
      (e) => !['button', 'submit', 'reset', 'hidden'].includes(e.type) && !e.hasAttribute('data-lecture')
    );
    // Un champ qui reste ouvert en lecture seule doit le DIRE (`data-lecture` : une
    // recherche, un zoom) ; les autres sont figés, `readOnly` ou `disabled`.
    const texteLibre = ['text', 'search', 'url', 'email', 'tel', 'number', 'password', 'date', 'datetime-local', 'time', 'month', 'week'];
    const figeParReadOnly = (e) => e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && texteLibre.includes(e.type));
    const ouverts = champs.filter((e) => !e.disabled && !(figeParReadOnly(e) && e.readOnly));
    exiger(ouverts.length === 0, `champ(s) modifiable(s) en lecture seule : ${ouverts.map((e) => e.outerHTML.slice(0, 80)).join(' | ')}`);
    await jouer(a.page, fixtures.edition, { tolerant: true });
    for (const bouton of [...a.page.container.querySelectorAll('button')]) {
      if (bouton.isConnected && !bouton.disabled) bouton.click();
      await vider(2);
    }
    for (const el of [...a.page.container.querySelectorAll('[tabindex], textarea, input, svg')]) {
      if (!el.isConnected) continue;
      for (const cle of ['Delete', 'Enter', 'ArrowRight', 'z']) {
        el.dispatchEvent(new w.KeyboardEvent('keydown', { key: cle, bubbles: true, cancelable: true, ctrlKey: cle === 'z' }));
      }
    }
    racineDe(a.page).dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    await a.page.horloge.avancer(5000);
    exiger(a.hote.traces.enregistrements.length === 0, 'saveBytes appelé en lecture seule');
    exiger(!a.hote.traces.sales.includes(true), 'onDirty(true) en lecture seule');
    const apres = await octetsDe(a);
    exiger(memesOctets(avant, apres), 'le document a changé en lecture seule');
    await detruire(a);
    return `${champs.length} champ(s) figé(s)`;
  });

  if (!fixtures.edition?.length) {
    resultats.push({ nom: 'édition et sauvegarde', ok: false, note: 'smoke.json ne décrit aucune étape « edition »' });
  } else {
    await scenario('édition, autosave ≥ 2 s et codes de rejet', async () => {
      const a = await monter(code, m, { octets, nomFichier, selection: selectionDe(dossier, fixtures), reseau: reseauDe(dossier, fixtures) });
      const t = a.hote.traces;
      const ctrlS = () =>
        racineDe(a.page).dispatchEvent(new a.page.window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));

      await jouer(a.page, fixtures.edition);
      exiger(t.sales.includes(true), "aucun onDirty(true) après une modification");
      await a.page.horloge.avancer(DELAI_MIN_MS - 10);
      exiger(t.enregistrements.length === 0, `sauvegarde avant ${DELAI_MIN_MS} ms : le debounce est trop court`);
      await a.page.horloge.avancer(400);
      exiger(t.enregistrements.length === 1, `une sauvegarde attendue après le debounce, ${t.enregistrements.length} vue(s)`);
      exiger(memesOctets(t.enregistrements[0], await octetsDe(a)), 'les octets enregistrés ne sont pas ceux de getBytes()');
      exiger(t.sales[t.sales.length - 1] === false, 'onDirty(false) attendu après une sauvegarde réussie');

      // Conflit : alerte, on reste sale, l'autosave se suspend jusqu'au geste explicite.
      a.hote.definirReponse(() => 'item_version_conflict');
      await jouer(a.page, fixtures.edition);
      await a.page.horloge.avancer(2400);
      exiger(t.enregistrements.length === 2, 'la sauvegarde rejetée en conflit n’a pas été tentée');
      exiger(alertes(a.page).length > 0, 'item_version_conflict : aucune alerte (role="alert") affichée');
      exiger(t.sales[t.sales.length - 1] === true, 'onDirty(false) après un rejet');
      await jouer(a.page, fixtures.edition);
      await a.page.horloge.avancer(2400);
      exiger(t.enregistrements.length === 2, "après un conflit, l'autosave doit attendre un geste de l'utilisateur");
      a.hote.definirReponse(() => null);
      ctrlS();
      await a.page.horloge.avancer(100);
      exiger(t.enregistrements.length === 3, 'Ctrl+S ne relance pas la sauvegarde après un conflit');
      exiger(alertes(a.page).length === 0, "l'alerte de conflit reste affichée après un enregistrement réussi");

      // Déjà en vol : rien d'alarmant, on réessaie au debounce suivant.
      let unCoup = true;
      a.hote.definirReponse(() => (unCoup ? ((unCoup = false), 'save_in_flight') : null));
      await jouer(a.page, fixtures.edition);
      await a.page.horloge.avancer(2400);
      exiger(alertes(a.page).length === 0, `save_in_flight ne doit rien afficher d'alarmant : ${alertes(a.page).join(' | ')}`);
      await a.page.horloge.avancer(2400);
      exiger(t.enregistrements.length === 5, `save_in_flight doit être réessayé (${t.enregistrements.length - 3} tentative(s))`);
      exiger(t.sales[t.sales.length - 1] === false, 'propre attendu après la nouvelle tentative');

      // Un code de l'hôte : affiché tel quel, on reste sale.
      a.hote.definirReponse(() => 'quota_exceeded');
      await jouer(a.page, fixtures.edition);
      await a.page.horloge.avancer(2400);
      exiger(alertes(a.page).some((x) => x.includes('quota_exceeded')), 'un code inconnu doit être affiché tel quel');
      exiger(t.sales[t.sales.length - 1] === true, 'onDirty(false) après un rejet');

      a.hote.definirReponse(() => 'read_only');
      await jouer(a.page, fixtures.edition);
      await a.page.horloge.avancer(2400);
      exiger(alertes(a.page).length > 0, 'read_only : aucune alerte affichée');

      await detruire(a);
      return `${t.enregistrements.length} tentatives, debounce ≥ ${DELAI_MIN_MS} ms`;
    });
  }

  await scenario('langue fr / en', async () => {
    const textes = [];
    for (const langue of ['fr', 'en']) {
      const a = await monter(code, m, { octets, nomFichier, langue });
      textes.push(texteVisible(a.page));
      await detruire(a);
    }
    exiger(textes[0] !== textes[1], "l'interface est identique en fr et en en");
    return 'interface traduite';
  });
}

function selectionDe(dossier, fixtures) {
  return (fixtures.selection ?? []).map((p) => ({ name: basename(p), octets: new Uint8Array(readFileSync(join(dossier, p))) }));
}

function reseauDe(dossier, fixtures, panne) {
  const regles = fixtures.reseau ?? [];
  return async (req) => {
    if (panne) throw new Error(panne);
    const r = regles.find((x) => req.url.startsWith(x.prefixe));
    if (!r) throw new Error('net_unreachable');
    const corps = r.fichier ? readFileSync(join(dossier, r.fichier)) : Buffer.from(r.corps ?? '', 'utf8');
    return { status: r.statut ?? 200, contentType: r.type ?? 'application/json', body: new Uint8Array(corps) };
  };
}

// ── Fonctions pures ─────────────────────────────────────────────────────────

function lireChamps(valeur, declares) {
  exiger(valeur && typeof valeur === 'object' && !Array.isArray(valeur), 'fields doit rendre un objet');
  for (const { key, type } of declares) {
    const v = valeur[key];
    if (v === undefined || v === null) continue;
    const bon =
      type === 'number'
        ? typeof v === 'number' && Number.isFinite(v)
        : type === 'checkbox'
          ? typeof v === 'boolean'
          : type === 'date'
            ? typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v)
            : type === 'url'
              ? typeof v === 'string' && /^https?:\/\//i.test(v) && v.length <= FIELD_TEXT_MAX
              : typeof v === 'string' && v.length <= FIELD_TEXT_MAX;
    exiger(bon, `fields.${key} (${type}) : valeur refusée par l'hôte (${JSON.stringify(v)})`);
  }
  for (const k of Object.keys(valeur)) {
    if (!declares.some((d) => d.key === k)) resultats.push({ nom: `fields.${k}`, ok: true, note: 'clé non déclarée : ignorée par l’hôte' });
  }
}

function signatureImage(o) {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (o.length >= 8 && png.every((b, i) => o[i] === b)) return 'png';
  if (o.length >= 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return 'jpeg';
  if (o.length >= 12 && String.fromCharCode(...o.slice(0, 4)) === 'RIFF' && String.fromCharCode(...o.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

async function scenariosFonctions(dossier, code, m, exemples) {
  const decl = m.capabilities?.functions;
  if (!decl) return;
  for (const f of [...exemples, null]) {
    const nom = f ? relative(dossier, f).replace(/\\/g, '/') : '(fichier vide)';
    const octets = f ? new Uint8Array(readFileSync(f)) : new Uint8Array(0);
    await scenario(`fonctions ${nom}`, async () => {
      // Une page en mode fonction ne monte rien et ne reçoit aucune API.
      const page = creerPage();
      const plugin = page.charger(code);
      const fns = plugin.functions;
      const ctx = (to) => ({ fileName: f ? basename(f) : `vide.${m.extensions[0]}`, to, locale: 'fr' });
      const appel = async (nomFn, to) => fns[nomFn](new page.window.Uint8Array(octets), ctx(to));
      const notes = [];
      try {
        if (decl.extractText) {
          const t = await appel('extractText');
          exiger(typeof t === 'string', 'extractText doit rendre une chaîne');
          notes.push(`texte ${t.length} car.${t.length > EXTRACT_MAX ? ' (coupé par l’hôte)' : ''}`);
        }
        if (decl.thumbnail) {
          const v = versOctets(await appel('thumbnail'));
          const sig = signatureImage(v);
          exiger(sig, 'thumbnail : ni PNG, ni JPEG, ni WebP (lu par ses octets)');
          exiger(v.byteLength <= THUMB_MAX, `thumbnail de ${v.byteLength} o : 96 Kio au plus`);
          notes.push(`vignette ${sig} ${(v.byteLength / 1024).toFixed(1)} Kio`);
        }
        if (decl.fields) {
          const champs = await appel('fields');
          lireChamps(champs, decl.fields);
          notes.push(`champs ${JSON.stringify(champs)}`);
        }
        for (const { to } of decl.exports ?? []) {
          const v = versOctets(await appel('export', to));
          const texte = new TextDecoder('utf-8', { fatal: true }).decode(v);
          if (to === 'json') JSON.parse(texte);
          if (to === 'html') exiger(/^<!doctype html>/i.test(texte.trimStart()), 'export html : document complet attendu');
          notes.push(`export ${to} ${v.byteLength} o`);
        }
      } finally {
        exiger(page.erreurs.length === 0, `erreurs : ${page.erreurs.join(' ; ')}`);
        page.fermer();
      }
      return notes.join(' · ');
    });
  }
}

// ── Bloc de note et widget ──────────────────────────────────────────────────

async function scenariosBloc(dossier, code, m, fixtures) {
  if (!m.capabilities?.noteBlock) return;
  const bloc = fixtures.bloc ?? {};
  const octets = bloc.fichier ? new Uint8Array(readFileSync(join(dossier, bloc.fichier))) : new Uint8Array(0);
  await scenario('bloc de note', async () => {
    const vide = await monter(code, m, { mode: 'block', octets: new Uint8Array(0), nomFichier: m.name });
    await vide.page.horloge.avancer(3000);
    exiger(vide.hote.traces.enregistrements.length === 0, 'un bloc neuf ne doit rien enregistrer sans modification');
    await detruire(vide, 'destroy (bloc vide)');

    const a = await monter(code, m, { mode: 'block', octets, nomFichier: m.name });
    exiger(texteVisible(a.page) !== '', 'le bloc ne montre rien');
    await jouer(a.page, bloc.edition);
    await a.page.horloge.avancer(DELAI_MIN_MS - 10);
    exiger(a.hote.traces.enregistrements.length === 0, 'bloc : sauvegarde avant 2 s');
    await a.page.horloge.avancer(400);
    if (bloc.edition?.length) exiger(a.hote.traces.enregistrements.length >= 1, 'bloc : la modification n’est pas enregistrée');
    const enregistre = a.hote.traces.enregistrements.at(-1);
    exiger(!enregistre || enregistre.byteLength <= 256 * 1024, 'bloc : 256 Kio au plus une fois décodé');
    await detruire(a, 'destroy (bloc)');

    const l = await monter(code, m, { mode: 'block', octets, nomFichier: m.name, lectureSeule: true });
    await jouer(l.page, bloc.edition, { tolerant: true });
    for (const b of [...l.page.container.querySelectorAll('button')]) if (b.isConnected && !b.disabled) b.click();
    await l.page.horloge.avancer(5000);
    exiger(l.hote.traces.enregistrements.length === 0, 'bloc en lecture seule : saveBytes appelé');
    await detruire(l, 'destroy (bloc en lecture seule)');
    return enregistre ? `enregistré ${enregistre.byteLength} o` : 'monté';
  });
}

async function scenariosWidget(dossier, code, m, fixtures) {
  if (!m.capabilities?.homeWidget) return;
  const config = new Uint8Array(Buffer.from(fixtures.widget?.config ?? '', 'utf8'));
  const cas = [
    ['widget (réseau simulé)', reseauDe(dossier, fixtures)],
    ['widget (web : unavailable)', reseauDe(dossier, fixtures, 'unavailable')],
    ['widget (refusé : net_refused)', reseauDe(dossier, fixtures, 'net_refused')],
    ['widget (réglage vide)', reseauDe(dossier, fixtures), new Uint8Array(0)],
  ];
  for (const [nom, reseau, octets] of cas) {
    await scenario(nom, async () => {
      const a = await monter(code, m, { mode: 'widget', octets: octets ?? config, nomFichier: m.name, lectureSeule: true, reseau });
      await a.page.horloge.avancer(1000);
      const texte = texteVisible(a.page);
      exiger(texte !== '', 'le widget ne montre rien');
      exiger(a.hote.traces.enregistrements.length === 0, 'un widget ne réécrit jamais rien');
      await a.page.horloge.avancer(60 * 60 * 1000);
      await detruire(a, 'destroy (widget)');
      return `« ${texte.slice(0, 70)} »`;
    });
  }
}

// ── Co-édition ──────────────────────────────────────────────────────────────

async function scenariosCollab(dossier, code, m, fixtures, exemples) {
  if (m.capabilities?.collab !== true) return;
  const premier = exemples.find((f) => m.extensions.includes(extname(f).slice(1).toLowerCase()));
  if (!premier) return;
  const octets = new Uint8Array(readFileSync(premier));
  const nomFichier = basename(premier);

  await scenario('co-édition : semis, convergence, élu', async () => {
    const journal = [];
    const pages = [];
    /** Le relais de l'hôte : chaque update envoyée est rangée, puis livrée aux AUTRES. */
    const distribuer = async () => {
      for (let tour = 0; tour < 5; tour++) {
        let bouge = false;
        for (const p of pages) {
          const nouvelles = p.hote.traces.envois.slice(p.lu);
          p.lu = p.hote.traces.envois.length;
          for (const u of nouvelles) {
            bouge = true;
            journal.push(u);
            for (const q of pages) if (q !== p && q.vivant) q.hote.collab.livrer(u);
          }
        }
        await vider();
        if (!bouge) break;
      }
    };
    const rejoindre = async (o) => {
      const p = await monter(code, m, { octets, nomFichier, collab: { seed: o.seed, responsible: o.responsible, updates: journal.slice() }, lectureSeule: o.lectureSeule });
      p.lu = 0;
      p.vivant = true;
      pages.push(p);
      await distribuer();
      return p;
    };

    const a = await rejoindre({ seed: true, responsible: true });
    exiger(a.hote.traces.semis === 1, `la page qui sème doit appeler seeded() une fois (${a.hote.traces.semis})`);
    exiger(journal.length > 0, 'la page qui sème n’a envoyé aucune update : la salle reste vide pour les autres');
    const b = await rejoindre({ seed: false, responsible: false });
    exiger(b.hote.traces.semis === 0, 'une page qui ne sème pas ne doit pas appeler seeded()');
    exiger(memesOctets(await octetsDe(a), await octetsDe(b)), 'B ne voit pas le document semé par A');

    await jouer(a.page, fixtures.edition);
    await distribuer();
    exiger(memesOctets(await octetsDe(a), await octetsDe(b)), 'A et B divergent après une modification de A');
    await a.page.horloge.avancer(2400);
    await b.page.horloge.avancer(2400);
    exiger(a.hote.traces.enregistrements.length >= 1, "l'élu n'a pas enregistré la modification");
    exiger(b.hote.traces.enregistrements.length === 0, "une page qui n'est pas l'élue a appelé saveBytes");

    const c = await rejoindre({ seed: false, responsible: false, lectureSeule: true });
    exiger(memesOctets(await octetsDe(a), await octetsDe(c)), 'un lecteur ne voit pas la salle');
    await jouer(c.page, fixtures.edition, { tolerant: true });
    await distribuer();
    exiger(c.hote.traces.envois.length === 0, 'un lecteur a envoyé des updates');

    // L'élu change : B reprend l'enregistrement de la salle.
    a.hote.collab.definirResponsable(false);
    b.hote.collab.definirResponsable(true);
    await vider();
    const avantA = a.hote.traces.enregistrements.length;
    await jouer(b.page, fixtures.edition);
    await distribuer();
    await a.page.horloge.avancer(2400);
    await b.page.horloge.avancer(2400);
    exiger(b.hote.traces.enregistrements.length >= 1, "le nouvel élu n'enregistre pas");
    exiger(a.hote.traces.enregistrements.length === avantA, "l'ancien élu enregistre encore");
    exiger(memesOctets(await octetsDe(a), await octetsDe(b)) && memesOctets(await octetsDe(b), await octetsDe(c)), 'les trois pages divergent');

    for (const p of pages) {
      p.vivant = false;
      await detruire(p, 'destroy (salle)');
    }
    return `${journal.length} update(s) relayée(s)`;
  });

  await scenario('co-édition : double semis', async () => {
    // Deux pages qui sèment la même salle (le filet des 3 s de l'hôte) ne doivent pas doubler le document.
    const a = await monter(code, m, { octets, nomFichier, collab: { seed: true, responsible: true, updates: [] } });
    const b = await monter(code, m, { octets, nomFichier, collab: { seed: true, responsible: false, updates: [] } });
    for (const u of a.hote.traces.envois) b.hote.collab.livrer(u);
    for (const u of b.hote.traces.envois) a.hote.collab.livrer(u);
    await vider();
    const oa = await octetsDe(a);
    const ob = await octetsDe(b);
    const seul = await monter(code, m, { octets, nomFichier });
    const os = await octetsDe(seul);
    await detruire(a);
    await detruire(b);
    await detruire(seul);
    exiger(memesOctets(oa, ob), 'deux semis concurrents divergent');
    exiger(memesOctets(oa, os), 'deux semis concurrents dupliquent le contenu');
    return 'idempotent';
  });

  await scenario('co-édition : salle sans host.collab', async () => {
    const a = await monter(code, m, { octets, nomFichier });
    exiger(a.hote.host.collab === undefined, 'hors salle, host.collab doit être absent');
    await jouer(a.page, fixtures.edition);
    await a.page.horloge.avancer(2400);
    exiger(a.hote.traces.enregistrements.length === 1, 'seul, l’éditeur doit enregistrer normalement');
    await detruire(a);
    return 'mode solo';
  });
}

// ── Le programme ────────────────────────────────────────────────────────────

async function main() {
  const dossier = dossierExemple(process.argv[2]);
  const config = JSON.parse(readFileSync(join(dossier, 'filarr.extension.json'), 'utf8'));
  const m = config.manifest;
  const bundle = join(dossier, 'dist', 'bundle.js');
  if (!existsSync(bundle)) throw new Error('dist/bundle.js absent — lancez « npm run build »');
  const code = readFileSync(bundle, 'utf8');
  const fixtures = existsSync(join(dossier, 'smoke.json')) ? JSON.parse(readFileSync(join(dossier, 'smoke.json'), 'utf8')) : {};
  const exts = [...m.extensions, ...(m.capabilities?.imports ?? [])];
  const exemples = lireTout(join(dossier, 'exemples'))
    .filter((f) => exts.includes(extname(f).slice(1).toLowerCase()))
    .sort();

  await scenariosEditeur(dossier, code, m, fixtures, exemples);
  await scenariosFonctions(dossier, code, m, exemples);
  await scenariosBloc(dossier, code, m, fixtures);
  await scenariosWidget(dossier, code, m, fixtures);
  await scenariosCollab(dossier, code, m, fixtures, exemples);

  let echecs = 0;
  for (const r of resultats) {
    if (r.ok) console.log(`ok     ${r.nom}${r.note ? ` — ${r.note}` : ''}`);
    else {
      echecs++;
      console.error(`ÉCHEC  ${r.nom} — ${r.note}`);
    }
  }
  const nom = basename(dossier);
  if (echecs) {
    console.error(`smoke ${nom} : ${echecs} échec(s) sur ${resultats.length}`);
    process.exit(1);
  }
  console.log(`smoke ${nom} : ${resultats.length} scénario(s) verts`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`smoke : ${e.stack ?? e}`);
    process.exit(1);
  });
}
