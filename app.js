(() => {
  'use strict';

  /* =====================================================================
     Batchkosten, kostprijs van een batch berekenen.
     Alles wordt lokaal bewaard (localStorage), er is geen server of account.
     Back-up en herstel gaan via een JSON-bestand.

     Rekenmodel (zoals in Kaasdagboek en Worstendagboek):
       kostprijs per eenheid = prijs per pakket / inhoud van het pakket
       kost van een regel    = gebruikte hoeveelheid x kostprijs per eenheid
     ===================================================================== */

  const KEY = 'batchkosten.v1';
  const KEY_UI = 'batchkosten.ui.v1';

  // Een lopende berekening wordt bewust niet bewaard, de tool start altijd met een leeg scherm.
  // Een concept uit een eerdere versie ruimen we hier op.
  try { localStorage.removeItem('batchkosten.concept.v1'); } catch (e) { /* geen opslag beschikbaar */ }

  // factor = aantal basiseenheden (g, ml, stuk) in deze eenheid.
  // tl en el zijn huismaten, die rekenen we om via ml (vloeistof) of via het gewicht per eetlepel (droge waar).
  const EENHEID = {
    g: { fam: 'massa', factor: 1 },
    kg: { fam: 'massa', factor: 1000 },
    ml: { fam: 'volume', factor: 1 },
    dl: { fam: 'volume', factor: 100 },
    l: { fam: 'volume', factor: 1000 },
    stuk: { fam: 'stuk', factor: 1 },
    tl: { fam: 'maat', factor: 5 },
    el: { fam: 'maat', factor: 15 },
  };
  // Eenheden waarin de inhoud van een pakket kan staan.
  const PAKKET_EENHEDEN = ['g', 'kg', 'ml', 'l', 'stuk'];
  const FAM_BASIS = { massa: 'g', volume: 'ml', stuk: 'stuk' };
  const FAM_WEERGAVE = { massa: { eenheid: 'kg', factor: 1000 }, volume: { eenheid: 'l', factor: 1000 }, stuk: { eenheid: 'stuk', factor: 1 } };

  // Eenheden voor de opbrengst, met de enkelvoudsvorm voor "Per ...".
  const OPBRENGST = { stuks: 'stuk', porties: 'portie', kg: 'kg', g: 'g', l: 'l', ml: 'ml' };
  // Waarmee we de kost vergelijken met de winkelprijs. Gram en ml worden per kg en per l vergeleken.
  const REF = { stuks: { label: 'stuk', deel: 1 }, porties: { label: 'portie', deel: 1 }, kg: { label: 'kg', deel: 1 }, g: { label: 'kg', deel: 1000 }, l: { label: 'l', deel: 1 }, ml: { label: 'l', deel: 1000 } };

  const heeft = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
  const fam = (eenheid) => (heeft(EENHEID, eenheid) ? EENHEID[eenheid].fam : null);

  /* ---------- Hulpfuncties ---------- */

  const uid = () =>
    (globalThis.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const vandaag = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in lokale tijd

  const fmtEur = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
  const fmtEurFijn = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const fmtGetal = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 3 });

  const eur = (x) => fmtEur.format(afronden(x));
  // Kleine bedragen (kruiden) tonen met meer decimalen, anders staat er overal 0,00.
  const eurFijn = (x) => (x > 0 && x < 0.1 ? fmtEurFijn.format(x) : fmtEur.format(afronden(x)));
  const afronden = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const getal = (x) => fmtGetal.format(x);

  function parseGetal(tekst) {
    let s = String(tekst).trim().replace(/\s/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const naarInvoer = (n) => (n == null ? '' : String(n).replace('.', ','));

  function datumTekst(iso) {
    const d = new Date(iso + 'T00:00:00');
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const sorteer = (lijst, sleutel) => [...lijst].sort((a, b) => sleutel(a).localeCompare(sleutel(b), 'nl', { sensitivity: 'base' }));

  /** Kleine DOM-helper, zet tekst altijd via textContent/createTextNode (geen innerHTML met gebruikersdata). */
  function h(tag, attrs, ...kinderen) {
    const el = document.createElement(tag);
    let waarde;
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') waarde = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kind of kinderen.flat()) {
      if (kind == null || kind === false) continue;
      el.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
    }
    if (waarde !== undefined) el.value = waarde; // na de opties, anders klopt een <select> niet
    return el;
  }

  /* ---------- Gegevens ---------- */

  const leeg = () => ({ v: 1, categorieen: [], grondstoffen: [], recepten: [], batches: [], laatsteBackup: null });

  const nieuwConcept = () => ({
    naam: '', datum: vandaag(), receptId: null, receptNaam: '',
    regels: [], extra: [], opbrengstAantal: null, opbrengstEenheid: 'stuks', winkelprijs: null, notitie: '',
  });

  /** Bouwt een schoon object uit onbetrouwbare JSON (bv. een geïmporteerde back-up). */
  function schoon(d) {
    // Een tekstbestand kan van alles zijn, dus controleren we of het echt op een back-up lijkt.
    if (!d || typeof d !== 'object' || !(Array.isArray(d.grondstoffen) || Array.isArray(d.recepten) || Array.isArray(d.batches))) {
      throw new Error('Dit is geen back-upbestand van Batchkosten.');
    }
    const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
    const nr = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const positief = (v) => (nr(v) > 0 ? v : null);
    const eh = (v) => (typeof v === 'string' && heeft(EENHEID, v) ? v : null);
    const pakketEh = (v) => (PAKKET_EENHEDEN.includes(v) ? v : null);
    const lijst = (v) => (Array.isArray(v) ? v : []);
    const opbEh = (v) => (typeof v === 'string' && heeft(OPBRENGST, v) ? v : 'stuks');
    const extra = (v) => lijst(v).map((e) => ({ naam: str(e && e.naam), bedrag: nr(e && e.bedrag) })).filter((e) => e.bedrag != null);

    const s = leeg();
    s.laatsteBackup = typeof d.laatsteBackup === 'string' ? d.laatsteBackup.slice(0, 40) : null;

    // Oudere back-ups hebben nog geen categorieën, dan blijft de lijst gewoon leeg.
    s.categorieen = lijst(d.categorieen).map((c) => ({ id: str(c && c.id, 80), naam: str(c && c.naam, 60) })).filter((c) => c.id && c.naam);
    const catIds = new Set(s.categorieen.map((c) => c.id));

    s.grondstoffen = lijst(d.grondstoffen).map((g) => {
      const eenheid = pakketEh(g && g.eenheid);
      return {
        id: str(g && g.id, 80), naam: str(g && g.naam, 80), prijs: nr(g && g.prijs), inhoud: nr(g && g.inhoud), eenheid,
        categorieId: g && catIds.has(g.categorieId) ? g.categorieId : null,
        gramPerEl: eenheid && fam(eenheid) === 'massa' ? positief(g && g.gramPerEl) : null,
        prijsDatum: str(g && g.prijsDatum, 10) || null,
        historie: lijst(g && g.historie).map((x) => ({ datum: str(x && x.datum, 10), pb: nr(x && x.pb) })).filter((x) => x.pb != null && x.pb >= 0).slice(-20),
      };
    }).filter((g) => g.id && g.naam && g.prijs != null && g.prijs >= 0 && g.inhoud > 0 && g.eenheid);

    s.recepten = lijst(d.recepten).map((r) => ({
      id: str(r && r.id, 80), naam: str(r && r.naam, 80),
      regels: lijst(r && r.regels).map((x) => ({ grondstofId: str(x && x.grondstofId, 80), hoeveelheid: nr(x && x.hoeveelheid), eenheid: eh(x && x.eenheid) })).filter((x) => x.grondstofId && x.eenheid),
      extra: extra(r && r.extra),
      opbrengstAantal: nr(r && r.opbrengstAantal), opbrengstEenheid: opbEh(r && r.opbrengstEenheid), winkelprijs: positief(r && r.winkelprijs),
    })).filter((r) => r.id && r.naam);

    s.batches = lijst(d.batches).map((b) => ({
      id: str(b && b.id, 80), datum: str(b && b.datum, 10), naam: str(b && b.naam, 80), receptNaam: str(b && b.receptNaam, 80),
      regels: lijst(b && b.regels).map((x) => ({
        grondstofId: str(x && x.grondstofId, 80), naam: str(x && x.naam, 80), hoeveelheid: nr(x && x.hoeveelheid), eenheid: eh(x && x.eenheid),
        kost: nr(x && x.kost), prijsPerBasis: nr(x && x.prijsPerBasis),
      })).filter((x) => x.eenheid && x.kost != null),
      extra: extra(b && b.extra),
      opbrengstAantal: nr(b && b.opbrengstAantal), opbrengstEenheid: opbEh(b && b.opbrengstEenheid), winkelprijs: positief(b && b.winkelprijs),
      grondKost: nr(b && b.grondKost) || 0, totaal: nr(b && b.totaal) || 0, notitie: str(b && b.notitie, 1000),
    })).filter((b) => b.id && b.datum);

    return s;
  }

  function leesOpslag(sleutel) {
    try {
      const raw = localStorage.getItem(sleutel);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function schrijfOpslag(sleutel, waarde) {
    try {
      localStorage.setItem(sleutel, JSON.stringify(waarde));
      return true;
    } catch (e) {
      return false;
    }
  }

  let state;
  try { state = schoon(leesOpslag(KEY) || leeg()); } catch (e) { state = leeg(); }

  let concept = nieuwConcept();

  let opslagFoutGetoond = false;
  function bewaar() {
    if (!schrijfOpslag(KEY, state) && !opslagFoutGetoond) {
      opslagFoutGetoond = true;
      toon('Opslaan in de browser lukt niet. Maak een back-up!');
    }
  }

  // Welke blokken open of dicht staan. Alleen een gemak, geen gegevens, dus niet in de back-up.
  const ui = { open: Object.create(null) };
  (function herstelUi() {
    const u = leesOpslag(KEY_UI);
    if (!u || typeof u.open !== 'object' || !u.open) return;
    for (const [k, v] of Object.entries(u.open)) if (typeof v === 'boolean') ui.open[k] = v;
  })();
  const bewaarUi = () => { schrijfOpslag(KEY_UI, ui); };

  /* ---------- Rekenwerk ---------- */

  const prijsPerBasis = (g) => g.prijs / (g.inhoud * EENHEID[g.eenheid].factor);

  /** Eenheden die bij deze grondstof kunnen. Eetlepels en theelepels voor droge waar vragen om een gewicht per eetlepel. */
  function eenhedenVoor(g) {
    const f = fam(g.eenheid);
    if (f === 'massa') return g.gramPerEl > 0 ? ['g', 'kg', 'tl', 'el'] : ['g', 'kg'];
    if (f === 'volume') return ['ml', 'dl', 'l', 'tl', 'el'];
    return ['stuk'];
  }

  /** De hoeveelheid in g, ml of stuk, of null als deze eenheid niet bij de grondstof past. */
  function basisHoeveelheid(g, hoeveelheid, eenheid) {
    if (!g || !(hoeveelheid > 0) || !heeft(EENHEID, eenheid)) return null;
    const e = EENHEID[eenheid];
    const gf = fam(g.eenheid);
    if (e.fam === gf) return hoeveelheid * e.factor;
    if (e.fam === 'maat') {
      if (gf === 'volume') return hoeveelheid * e.factor; // tl en el zijn 5 en 15 ml
      if (gf === 'massa' && g.gramPerEl > 0) return hoeveelheid * (e.factor / 15) * g.gramPerEl; // een tl is een derde el
    }
    return null;
  }

  function regelKost(g, hoeveelheid, eenheid) {
    const basis = basisHoeveelheid(g, hoeveelheid, eenheid);
    return basis == null ? 0 : basis * prijsPerBasis(g);
  }

  /** Prijs zoals je hem op het etiket verwacht, per kg, per l of per stuk. */
  function prijsWeergave(g) {
    const w = FAM_WEERGAVE[EENHEID[g.eenheid].fam];
    return { bedrag: prijsPerBasis(g) * w.factor, eenheid: w.eenheid };
  }

  /** Werkt voor een concept, recept of opgeslagen batch (zelfde veldnamen). */
  function bereken(c) {
    const perId = new Map(state.grondstoffen.map((g) => [g.id, g]));
    const regels = c.regels.map((r) => ({ r, g: perId.get(r.grondstofId), kost: regelKost(perId.get(r.grondstofId), r.hoeveelheid, r.eenheid) }));
    const grondKost = regels.reduce((s, x) => s + x.kost, 0);
    const extraKost = c.extra.reduce((s, e) => s + (e.bedrag > 0 ? e.bedrag : 0), 0);
    const totaal = grondKost + extraKost;
    return { regels, grondKost, extraKost, totaal, per: perEenheid(totaal, c.opbrengstAantal, c.opbrengstEenheid) };
  }

  function perEenheid(totaal, aantal, eenheid) {
    if (!(aantal > 0)) return [];
    const per = totaal / aantal;
    const uit = [{ label: `Per ${OPBRENGST[eenheid]}`, waarde: per }];
    if (eenheid === 'g') uit.push({ label: 'Per kg', waarde: per * 1000 });
    if (eenheid === 'ml') uit.push({ label: 'Per l', waarde: per * 1000 });
    return uit;
  }

  /** Totaal van een opgeslagen batch met de prijzen van vandaag (regels zonder bruikbare grondstof houden hun oude kost). */
  function herbereken(b) {
    const perId = new Map(state.grondstoffen.map((g) => [g.id, g]));
    const grond = b.regels.reduce((s, r) => {
      const g = perId.get(r.grondstofId);
      const basis = g ? basisHoeveelheid(g, r.hoeveelheid, r.eenheid) : null;
      return s + (basis != null ? basis * prijsPerBasis(g) : r.kost);
    }, 0);
    return grond + b.extra.reduce((s, e) => s + (e.bedrag > 0 ? e.bedrag : 0), 0);
  }

  /** Zelf maken tegenover de winkelprijs, per stuk, kg, l of portie. Null als er iets ontbreekt. */
  function vergelijk(totaal, aantal, eenheid, winkelprijs) {
    if (!(aantal > 0) || !(winkelprijs > 0) || !heeft(REF, eenheid)) return null;
    const ref = REF[eenheid];
    const aantalRef = aantal / ref.deel;
    const kost = totaal / aantalRef;
    const verschil = winkelprijs - kost;
    return { label: ref.label, kost, winkelprijs, verschil, pct: (verschil / winkelprijs) * 100, totaalVerschil: verschil * aantalRef };
  }

  function vergelijkTekst(v) {
    if (!v) return null;
    const basis = `Winkelprijs ${eur(v.winkelprijs)} per ${v.label}`;
    if (Math.abs(v.verschil) < 0.005) return `${basis}, zelf maken kost evenveel.`;
    return v.verschil > 0
      ? `${basis}. Je bespaart ${eur(v.verschil)} per ${v.label} (${Math.round(v.pct)}%), ${eur(v.totaalVerschil)} in totaal.`
      : `${basis}. Zelf maken is ${eur(-v.verschil)} per ${v.label} duurder, ${eur(-v.totaalVerschil)} in totaal.`;
  }

  /* ---------- Meldingen en dialoog ---------- */

  let toastTimer;
  function toon(tekst) {
    const el = document.getElementById('toast');
    el.textContent = tekst;
    el.classList.add('zichtbaar');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('zichtbaar'), 3200);
  }

  /**
   * Toont een dialoog met zelfgemaakte inhoud. `maak(sluit)` geeft het element terug, en `sluit(waarde)` sluit de
   * dialoog en geeft die waarde terug. Esc geeft null. De uitkomst gaat direct bij de klik door, het close-event
   * is er alleen voor de Esc-toets.
   */
  function dialoogVorm(maak) {
    return new Promise((resolve) => {
      const dlg = document.getElementById('dlg');
      if (dlg.open) dlg.close();
      dlg.replaceChildren();
      let klaar = false;
      const sluit = (uitkomst) => {
        if (klaar) return;
        klaar = true;
        dlg.removeEventListener('close', bijSluiten);
        if (dlg.open) dlg.close();
        resolve(uitkomst === undefined ? null : uitkomst);
      };
      // Een close-event komt asynchroon binnen. Staat er dan al een nieuwe dialoog open (bv. twee dialogen
      // achter elkaar), dan hoort het event bij de vorige en negeren we het.
      const bijSluiten = () => { if (!dlg.open) sluit(null); };
      dlg.addEventListener('close', bijSluiten);
      dlg.append(maak(sluit));
      dlg.showModal();
    });
  }

  /** Bevestiging of invoer. Geeft true/false terug, of bij `invoer` de ingetypte tekst (null bij annuleren). */
  function dialoog({ titel, tekst, invoer = false, waarde = '', ok = 'OK', annuleer = 'Annuleren', gevaar = false }) {
    return dialoogVorm((sluit) => {
      const veld = invoer ? h('input', { type: 'text', value: waarde, maxlength: 80, 'aria-label': titel }) : null;
      const form = h('form', { class: 'dlg-form', method: 'dialog' },
        h('h3', null, titel),
        tekst ? h('p', { class: 'muted' }, tekst) : null,
        veld,
        h('div', { class: 'dlg-knoppen' },
          annuleer ? h('button', { type: 'button', class: 'knop', onclick: () => sluit(invoer ? null : false) }, annuleer) : null,
          h('button', { type: 'submit', class: 'knop ' + (gevaar ? 'gevaar' : 'primair') }, ok)));
      form.addEventListener('submit', (e) => { e.preventDefault(); sluit(invoer ? veld.value.trim() : true); });
      if (veld) setTimeout(() => { veld.focus(); veld.select(); }, 0);
      return form;
    }).then((uitkomst) => (invoer ? uitkomst : uitkomst === true));
  }

  /* ---------- Navigatie ---------- */

  const icoon = (d) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const pad of d) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', pad);
      svg.append(p);
    }
    return svg;
  };

  const TABS = [
    { id: 'berekenen', label: 'Berekenen', pad: ['M5 3h14v18H5z', 'M8 7h8', 'M8 12h2', 'M14 12h2', 'M8 16h2', 'M14 16h2'] },
    { id: 'historie', label: 'Historie', pad: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v4h4', 'M12 7v5l3 2'] },
    { id: 'recepten', label: 'Recepten', pad: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h11', 'M9 8h6'] },
    { id: 'instellingen', label: 'Instellingen', pad: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12l2-1-2-3-2 1a7 7 0 0 0-2-1l-.5-2h-3L11 8a7 7 0 0 0-2 1L7 8l-2 3 2 1a7 7 0 0 0 0 2l-2 1 2 3 2-1a7 7 0 0 0 2 1l.5 2h3l.5-2a7 7 0 0 0 2-1l2 1 2-3-2-1a7 7 0 0 0 0-2z'] },
  ];

  const huidigeTab = () => {
    const id = location.hash.slice(1);
    return TABS.some((t) => t.id === id) ? id : 'berekenen';
  };

  function gaNaar(id) {
    if (location.hash === '#' + id) render();
    else location.hash = id;
  }

  let vorigeTab = null;

  function render() {
    const tab = huidigeTab();
    const nav = document.getElementById('tabs');
    nav.replaceChildren(...TABS.map((t) =>
      h('a', { class: 'tab', href: '#' + t.id, 'aria-current': t.id === tab ? 'page' : null }, icoon(t.pad), t.label)));
    const view = document.getElementById('view');
    view.replaceChildren();
    ({ berekenen: viewBerekenen, historie: viewHistorie, recepten: viewRecepten, instellingen: viewInstellingen })[tab](view);
    if (tab !== vorigeTab) window.scrollTo(0, 0);
    vorigeTab = tab;
  }

  /* =====================================================================
     Scherm: Berekenen
     ===================================================================== */

  const conceptHeeftInhoud = () =>
    concept.regels.some((r) => r.grondstofId || r.hoeveelheid != null) || concept.extra.length > 0 || concept.naam.trim() !== '';

  async function laadInConcept(nieuw) {
    if (conceptHeeftInhoud() && !(await dialoog({ titel: 'Huidige invoer vervangen?', tekst: 'Wat je nu op het scherm Berekenen hebt staan, gaat verloren.', ok: 'Vervangen' }))) return false;
    concept = nieuw;
    gaNaar('berekenen');
    return true;
  }

  /** Begin met een leeg scherm. Vraagt eerst bevestiging als er iets ingevuld staat. */
  async function leegmaken() {
    if (!conceptHeeftInhoud()) { toon('Het scherm is al leeg.'); return; }
    if (await dialoog({ titel: 'Alles leegmaken?', tekst: 'De huidige invoer wordt gewist.', ok: 'Leegmaken', gevaar: true })) {
      concept = nieuwConcept();
      render();
    }
  }

  /** Dialoog om een grondstof te kiezen, met zoeken. Geeft { id }, { nieuw: zoektekst } of null. */
  function kiesGrondstof(huidigId) {
    return dialoogVorm((sluit) => {
      const zoek = h('input', { type: 'search', placeholder: 'Zoek grondstof', 'aria-label': 'Zoek grondstof', autocomplete: 'off' });
      const lijst = h('div', { class: 'kieslijst' });

      const teken = () => {
        const q = zoek.value.trim().toLowerCase();
        const pas = (g) => !q || g.naam.toLowerCase().includes(q);
        const groepen = state.categorieen.length
          ? [
            ...sorteer(state.categorieen, (c) => c.naam).map((c) => ({ naam: c.naam, items: state.grondstoffen.filter((g) => g.categorieId === c.id && pas(g)) })),
            { naam: 'Zonder categorie', items: state.grondstoffen.filter((g) => !g.categorieId && pas(g)) },
          ]
          : [{ naam: '', items: state.grondstoffen.filter(pas) }];
        const zichtbaar = groepen.filter((gr) => gr.items.length);
        const knoppen = zichtbaar.flatMap((gr) => [
          gr.naam ? h('div', { class: 'kiesgroep' }, gr.naam) : null,
          ...sorteer(gr.items, (g) => g.naam).map((g) => {
            const p = prijsWeergave(g);
            return h('button', { type: 'button', class: 'kiesitem' + (g.id === huidigId ? ' actief' : ''), onclick: () => sluit({ id: g.id }) },
              h('span', { class: 'kn' }, g.naam), h('span', { class: 'muted' }, `${eur(p.bedrag)} / ${p.eenheid}`));
          }),
        ]).filter(Boolean);
        lijst.replaceChildren(...(knoppen.length ? knoppen : [h('p', { class: 'leeg' }, state.grondstoffen.length ? 'Niets gevonden.' : 'Je hebt nog geen grondstoffen.')]));
      };
      zoek.addEventListener('input', teken);
      teken();
      // De browser focust zelf het eerste veld. Bij een korte lijst halen we dat weer weg, zodat op een telefoon
      // het toetsenbord dicht blijft en je de lijst ziet. Bij een lange lijst typ je juist meteen.
      setTimeout(() => (state.grondstoffen.length > 8 ? zoek.focus() : zoek.blur()), 0);

      return h('div', { class: 'dlg-form kies' },
        h('h3', null, 'Kies grondstof'),
        zoek,
        lijst,
        h('div', { class: 'dlg-knoppen' },
          h('button', { type: 'button', class: 'knop', onclick: () => sluit(null) }, 'Annuleren'),
          h('button', { type: 'button', class: 'knop primair', onclick: () => sluit({ nieuw: zoek.value.trim() }) }, '+ Nieuwe grondstof')));
    });
  }

  /** Nieuwe grondstof aanmaken zonder het scherm te verlaten. Geeft de grondstof terug, of null bij annuleren. */
  function nieuweGrondstofDialoog(voorNaam) {
    return dialoogVorm((sluit) => grondstofFormulier(null, {
      voorNaam, inDialoog: true,
      opKlaar: (g) => { toon(`“${g.naam}” toegevoegd.`); sluit(g); },
      opAnnuleer: () => sluit(null),
    }));
  }

  /** Dialoog om alle hoeveelheden te vermenigvuldigen. Geeft de factor terug, of null. */
  function schaalDialoog(regels) {
    return dialoogVorm((sluit) => {
      const factorIn = h('input', { type: 'text', inputmode: 'decimal', value: '2', 'aria-label': 'Factor' });
      const chips = [0.5, 2, 3, 4].map((f) => h('button', { type: 'button', class: 'knop klein', onclick: () => { factorIn.value = naarInvoer(f); gebruikDoel.value = ''; zetDoel(); } }, `×${naarInvoer(f)}`));
      const gebruikDoel = h('select', { 'aria-label': 'Schalen op een grondstof' },
        h('option', { value: '' }, 'Niet gebruiken'),
        regels.map((x, i) => h('option', { value: String(i) }, `${x.g.naam} (nu ${getal(x.r.hoeveelheid)} ${x.r.eenheid})`)));
      const doelIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Nieuwe hoeveelheid', 'aria-label': 'Nieuwe hoeveelheid' });
      const eenheidTekst = h('span', { class: 'muted' });
      const doelVeld = h('label', { class: 'veld', hidden: true }, 'Nieuwe hoeveelheid', doelIn, eenheidTekst);
      const zetDoel = () => {
        const x = regels[Number(gebruikDoel.value)];
        doelVeld.hidden = gebruikDoel.value === '' || !x;
        eenheidTekst.textContent = x ? `in ${x.r.eenheid}, de rest schaalt mee` : '';
      };
      gebruikDoel.addEventListener('change', zetDoel);

      const form = h('form', { class: 'dlg-form', method: 'dialog' },
        h('h3', null, 'Schalen'),
        h('p', { class: 'muted' }, 'Alle hoeveelheden en de opbrengst worden vermenigvuldigd. Overige kosten blijven gelijk.'),
        h('label', { class: 'veld' }, 'Vermenigvuldigen met', factorIn),
        h('div', { class: 'chips' }, chips),
        h('label', { class: 'veld' }, 'Of schaal op een grondstof', gebruikDoel),
        doelVeld,
        h('div', { class: 'dlg-knoppen' },
          h('button', { type: 'button', class: 'knop', onclick: () => sluit(null) }, 'Annuleren'),
          h('button', { type: 'submit', class: 'knop primair' }, 'Schalen')));

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        let factor;
        if (gebruikDoel.value !== '') {
          const x = regels[Number(gebruikDoel.value)];
          const doel = parseGetal(doelIn.value);
          if (!(doel > 0)) { toon('Vul de nieuwe hoeveelheid in.'); doelIn.focus(); return; }
          factor = doel / x.r.hoeveelheid;
        } else {
          factor = parseGetal(factorIn.value);
        }
        if (!(factor > 0) || !Number.isFinite(factor) || factor > 1000) { toon('Vul een geldige factor in, bijvoorbeeld 2 of 0,5.'); factorIn.focus(); return; }
        sluit(factor);
      });
      return form;
    });
  }

  async function schalen() {
    const regels = bereken(concept).regels.filter((x) => x.g && x.r.hoeveelheid > 0);
    if (!regels.length) { toon('Voeg eerst grondstoffen met een hoeveelheid toe.'); return; }
    const factor = await schaalDialoog(regels);
    if (!factor) return;
    const rond = (x) => Math.round(x * 10000) / 10000;
    for (const r of concept.regels) if (r.hoeveelheid > 0) r.hoeveelheid = rond(r.hoeveelheid * factor);
    if (concept.opbrengstAantal > 0) concept.opbrengstAantal = rond(concept.opbrengstAantal * factor);
    toon(`Hoeveelheden keer ${getal(factor)}`);
    render();
  }

  function viewBerekenen(root) {
    const c = concept;
    const rijen = []; // { r, kostEl, kies }

    const ververs = () => {
      const res = bereken(c);
      for (const rij of rijen) {
        const x = res.regels.find((y) => y.r === rij.r);
        rij.kostEl.textContent = x && x.kost > 0 ? eurFijn(x.kost) : '';
      }
      uit.totaal.textContent = eur(res.totaal);
      uit.perLabel.textContent = res.per[0] ? res.per[0].label : 'Per eenheid';
      uit.per.textContent = res.per[0] ? eurFijn(res.per[0].waarde) : '-';
      uit.sub.textContent = !res.per[0]
        ? (res.totaal > 0 ? 'Vul de opbrengst in voor de kost per stuk.' : '')
        : res.per[1] ? `${res.per[1].label} ${eurFijn(res.per[1].waarde)}` : (res.extraKost > 0 ? `Grondstoffen ${eur(res.grondKost)} + overig ${eur(res.extraKost)}` : '');
      winkelLabel.textContent = `Winkelprijs per ${REF[c.opbrengstEenheid].label} (optioneel)`;
      uit.vergelijk.textContent = vergelijkTekst(vergelijk(res.totaal, c.opbrengstAantal, c.opbrengstEenheid, c.winkelprijs)) || '';
    };

    /* -- Kop -- */
    const naamIn = h('input', { type: 'text', value: c.naam, maxlength: 80, placeholder: 'bv. Brood, Boterhamworst', oninput: (e) => { c.naam = e.target.value; } });
    const datumIn = h('input', { type: 'date', value: c.datum, onchange: (e) => { c.datum = e.target.value || vandaag(); } });
    const receptSel = h('select', {
      value: state.recepten.some((r) => r.id === c.receptId) ? c.receptId : '',
      onchange: async (e) => {
        const rec = state.recepten.find((r) => r.id === e.target.value);
        if (!rec) { c.receptId = null; c.receptNaam = ''; return; }
        const gelukt = await laadInConcept(conceptVanRecept(rec));
        if (!gelukt) e.target.value = c.receptId || '';
      },
    }, h('option', { value: '' }, 'Los beginnen'), sorteer(state.recepten, (r) => r.naam).map((r) => h('option', { value: r.id }, r.naam)));

    root.append(h('div', { class: 'kopbalk' },
      h('h2', null, 'Berekenen'),
      h('div', { class: 'rijknoppen' },
        h('button', { type: 'button', class: 'knop klein', onclick: schalen }, 'Schalen'),
        h('button', { type: 'button', class: 'knop klein', onclick: leegmaken }, 'Leegmaken'))));

    root.append(h('section', { class: 'card stapel' },
      h('div', { class: 'rij2' },
        h('label', { class: 'veld' }, 'Naam van de batch', naamIn),
        h('label', { class: 'veld' }, 'Datum', datumIn)),
      state.recepten.length ? h('label', { class: 'veld' }, 'Start vanuit recept', receptSel) : null));

    /* -- Grondstoffen -- */
    const regelsEl = h('div');
    const maakRegel = (r) => {
      const kostEl = h('span', { class: 'kost' });
      const eenheidSel = h('select', { 'aria-label': 'Eenheid' });
      const vulEenheden = () => {
        const g = state.grondstoffen.find((x) => x.id === r.grondstofId);
        eenheidSel.replaceChildren();
        if (!g) { eenheidSel.append(h('option', { value: '' }, '-')); eenheidSel.disabled = true; return; }
        const opties = eenhedenVoor(g);
        // Standaard in gram, ml of stuk: zo wordt "10" bij zout nooit per ongeluk 10 kg.
        if (!opties.includes(r.eenheid)) r.eenheid = FAM_BASIS[fam(g.eenheid)];
        eenheidSel.disabled = false;
        for (const e of opties) eenheidSel.append(h('option', { value: e, selected: e === r.eenheid }, e));
      };

      const kiezer = h('button', { type: 'button', class: 'kiezer', 'aria-haspopup': 'dialog', 'aria-label': 'Grondstof kiezen' });
      const toonKeuze = () => {
        const g = state.grondstoffen.find((x) => x.id === r.grondstofId);
        if (g) {
          const p = prijsWeergave(g);
          kiezer.replaceChildren(h('span', { class: 'kn' }, g.naam), h('span', { class: 'kp' }, `${eur(p.bedrag)} / ${p.eenheid}`));
        } else {
          kiezer.replaceChildren(h('span', { class: 'plaats' }, 'Kies grondstof'));
        }
      };

      const hoeveelheidIn = h('input', {
        type: 'text', inputmode: 'decimal', placeholder: 'Hoeveelheid', 'aria-label': 'Hoeveelheid',
        value: naarInvoer(r.hoeveelheid),
        oninput: (e) => { r.hoeveelheid = parseGetal(e.target.value); ververs(); },
      });
      eenheidSel.addEventListener('change', (e) => { r.eenheid = e.target.value; ververs(); });

      /** Opent de kiezer. Geeft true terug als er een grondstof gekozen is. */
      const kies = async () => {
        const keuze = await kiesGrondstof(r.grondstofId);
        if (!keuze) return false;
        const g = keuze.nieuw !== undefined
          ? await nieuweGrondstofDialoog(keuze.nieuw)
          : state.grondstoffen.find((x) => x.id === keuze.id);
        if (!g) return false;
        r.grondstofId = g.id;
        r.hint = '';
        vulEenheden();
        toonKeuze();
        ververs();
        hoeveelheidIn.focus();
        return true;
      };
      kiezer.addEventListener('click', kies);

      toonKeuze();
      vulEenheden();

      const rijEl = h('div', { class: 'regel' },
        kiezer,
        h('button', {
          type: 'button', class: 'icoonknop', 'aria-label': 'Regel verwijderen',
          onclick: () => verwijderRij(r, rijEl),
        }, '×'),
        h('div', { class: 'onder' }, hoeveelheidIn, eenheidSel, kostEl),
        r.hint ? h('div', { class: 'hint' }, r.hint) : null);
      rijen.push({ r, kostEl, kies });
      return rijEl;
    };

    const verwijderRij = (r, rijEl) => {
      c.regels.splice(c.regels.indexOf(r), 1);
      rijen.splice(rijen.findIndex((x) => x.r === r), 1);
      rijEl.remove();
      ververs();
    };

    c.regels.forEach((r) => regelsEl.append(maakRegel(r)));

    // Een nieuwe regel opent meteen de lijst, dat scheelt een tik. Annuleren ruimt de lege regel weer op.
    const nieuweRegel = async () => {
      const r = { id: uid(), grondstofId: '', hoeveelheid: null, eenheid: '', hint: '' };
      c.regels.push(r);
      const el = maakRegel(r);
      regelsEl.append(el);
      const gekozen = await rijen.find((x) => x.r === r).kies();
      if (!gekozen && !r.grondstofId) verwijderRij(r, el);
    };

    root.append(h('section', { class: 'card' },
      h('h2', null, 'Grondstoffen'),
      regelsEl,
      h('button', { type: 'button', class: 'knop', onclick: nieuweRegel }, '+ Grondstof toevoegen')));

    /* -- Overige kosten -- */
    const extraEl = h('div');
    const maakExtra = (e) => {
      const el = h('div', { class: 'extra' },
        h('input', { type: 'text', maxlength: 80, placeholder: 'bv. energie, verpakking', 'aria-label': 'Omschrijving', value: e.naam, oninput: (ev) => { e.naam = ev.target.value; } }),
        h('input', { type: 'text', inputmode: 'decimal', placeholder: '€', 'aria-label': 'Bedrag in euro', value: naarInvoer(e.bedrag), oninput: (ev) => { e.bedrag = parseGetal(ev.target.value); ververs(); } }),
        h('button', { type: 'button', class: 'icoonknop', 'aria-label': 'Kost verwijderen', onclick: () => { c.extra.splice(c.extra.indexOf(e), 1); el.remove(); ververs(); } }, '×'));
      return el;
    };
    c.extra.forEach((e) => extraEl.append(maakExtra(e)));
    root.append(h('section', { class: 'card' },
      h('h2', null, 'Overige kosten'),
      extraEl,
      h('button', { type: 'button', class: 'knop', onclick: () => {
        const e = { id: uid(), naam: '', bedrag: null };
        c.extra.push(e);
        const el = maakExtra(e);
        extraEl.append(el);
        el.querySelector('input').focus();
      } }, '+ Kost toevoegen')));

    /* -- Opbrengst, winkelprijs en notitie -- */
    const winkelLabel = h('span');
    root.append(h('section', { class: 'card stapel' },
      h('h2', null, 'Opbrengst'),
      h('div', { class: 'rij2' },
        h('label', { class: 'veld' }, 'Hoeveel heb je gemaakt?',
          h('input', { type: 'text', inputmode: 'decimal', placeholder: 'bv. 2', value: naarInvoer(c.opbrengstAantal), oninput: (e) => { c.opbrengstAantal = parseGetal(e.target.value); ververs(); } })),
        h('label', { class: 'veld' }, 'Eenheid',
          h('select', { value: c.opbrengstEenheid, onchange: (e) => { c.opbrengstEenheid = e.target.value; ververs(); } },
            Object.keys(OPBRENGST).map((k) => h('option', { value: k }, k))))),
      h('label', { class: 'veld' }, winkelLabel,
        h('input', { type: 'text', inputmode: 'decimal', placeholder: 'bv. 2,50', value: naarInvoer(c.winkelprijs), oninput: (e) => { c.winkelprijs = parseGetal(e.target.value); ververs(); } }),
        h('span', { class: 'muted' }, 'Vul in wat hetzelfde product in de winkel kost, dan zie je wat je bespaart.')),
      h('label', { class: 'veld' }, 'Notitie (optioneel)',
        h('textarea', { maxlength: 1000, oninput: (e) => { c.notitie = e.target.value; } }, c.notitie))));

    /* -- Samenvatting (blijft in beeld) -- */
    const uit = {
      totaal: h('strong'), perLabel: h('span', { class: 'lbl' }), per: h('strong'),
      sub: h('div', { class: 'sub' }), vergelijk: h('div', { class: 'sub vergelijk' }),
    };
    root.append(h('section', { class: 'samenvatting', 'aria-live': 'polite' },
      h('div', { class: 'totaal' }, h('span', { class: 'lbl' }, 'Totale kost'), uit.totaal),
      h('div', null, uit.perLabel, uit.per),
      uit.sub,
      uit.vergelijk));

    root.append(h('div', { class: 'knoppen' },
      h('button', { type: 'button', class: 'knop primair', onclick: slaBatchOp }, 'Opslaan in historie'),
      h('button', { type: 'button', class: 'knop', onclick: slaReceptOp }, 'Opslaan als recept')));

    ververs();
  }

  /** Alleen regels met een grondstof en een hoeveelheid tellen mee. */
  function geldigeRegels() {
    return concept.regels.filter((r) => state.grondstoffen.some((g) => g.id === r.grondstofId) && r.hoeveelheid > 0);
  }

  async function slaBatchOp() {
    const regels = geldigeRegels();
    if (!regels.length) { toon('Voeg minstens één grondstof met een hoeveelheid toe.'); return; }
    const c = concept;
    const res = bereken({ ...c, regels });
    const naam = c.naam.trim() || c.receptNaam || 'Batch zonder naam';
    state.batches.push({
      id: uid(), datum: c.datum || vandaag(), naam, receptNaam: c.receptNaam,
      regels: res.regels.map(({ r, g, kost }) => ({
        grondstofId: g.id, naam: g.naam, hoeveelheid: r.hoeveelheid, eenheid: r.eenheid, kost, prijsPerBasis: prijsPerBasis(g),
      })),
      extra: c.extra.filter((e) => e.bedrag > 0).map((e) => ({ naam: e.naam.trim() || 'Overige kost', bedrag: e.bedrag })),
      opbrengstAantal: c.opbrengstAantal > 0 ? c.opbrengstAantal : null, opbrengstEenheid: c.opbrengstEenheid,
      winkelprijs: c.winkelprijs > 0 ? c.winkelprijs : null,
      grondKost: res.grondKost, totaal: res.totaal, notitie: c.notitie.trim(),
    });
    bewaar();
    concept = nieuwConcept();
    toon(`“${naam}” opgeslagen, totaal ${eur(res.totaal)}`);
    gaNaar('historie');
  }

  async function slaReceptOp() {
    const regels = geldigeRegels();
    if (!regels.length) { toon('Voeg minstens één grondstof met een hoeveelheid toe.'); return; }
    const c = concept;
    const naam = await dialoog({ titel: 'Naam van het recept', invoer: true, waarde: c.receptNaam || c.naam.trim(), ok: 'Opslaan' });
    if (!naam) return;
    const bestaand = state.recepten.find((r) => r.naam.toLowerCase() === naam.toLowerCase());
    if (bestaand && !(await dialoog({ titel: 'Recept bestaat al', tekst: `“${bestaand.naam}” wordt overschreven.`, ok: 'Overschrijven' }))) return;
    const rec = {
      id: bestaand ? bestaand.id : uid(), naam,
      regels: regels.map((r) => ({ grondstofId: r.grondstofId, hoeveelheid: r.hoeveelheid, eenheid: r.eenheid })),
      extra: c.extra.filter((e) => e.bedrag > 0).map((e) => ({ naam: e.naam.trim() || 'Overige kost', bedrag: e.bedrag })),
      opbrengstAantal: c.opbrengstAantal > 0 ? c.opbrengstAantal : null, opbrengstEenheid: c.opbrengstEenheid,
      winkelprijs: c.winkelprijs > 0 ? c.winkelprijs : null,
    };
    if (bestaand) state.recepten[state.recepten.indexOf(bestaand)] = rec;
    else state.recepten.push(rec);
    bewaar();
    // Net als bij de historie: het scherm is weer leeg voor de volgende berekening.
    concept = nieuwConcept();
    toon(`Recept “${naam}” opgeslagen.`);
    render();
  }

  function conceptVanRecept(rec) {
    return {
      ...nieuwConcept(),
      naam: rec.naam, receptId: rec.id, receptNaam: rec.naam,
      regels: rec.regels.map((r) => ({ id: uid(), grondstofId: r.grondstofId, hoeveelheid: r.hoeveelheid, eenheid: r.eenheid, hint: '' })),
      extra: rec.extra.map((e) => ({ id: uid(), naam: e.naam, bedrag: e.bedrag })),
      opbrengstAantal: rec.opbrengstAantal, opbrengstEenheid: rec.opbrengstEenheid, winkelprijs: rec.winkelprijs,
    };
  }

  function conceptVanBatch(b) {
    const bestaat = (id) => state.grondstoffen.some((g) => g.id === id);
    return {
      ...nieuwConcept(),
      naam: b.naam, receptNaam: b.receptNaam,
      regels: b.regels.map((r) => ({
        id: uid(), grondstofId: bestaat(r.grondstofId) ? r.grondstofId : '', hoeveelheid: r.hoeveelheid, eenheid: r.eenheid,
        hint: bestaat(r.grondstofId) ? '' : `“${r.naam}” bestaat niet meer, kies een andere grondstof.`,
      })),
      extra: b.extra.map((e) => ({ id: uid(), naam: e.naam, bedrag: e.bedrag })),
      opbrengstAantal: b.opbrengstAantal, opbrengstEenheid: b.opbrengstEenheid, winkelprijs: b.winkelprijs, notitie: b.notitie,
    };
  }

  /* =====================================================================
     Delen en afdrukken
     ===================================================================== */

  /** Zet een batch of recept om naar een vaste vorm, voor delen en afdrukken. */
  function deelVorm(item) {
    if (item.regels.length && 'kost' in item.regels[0]) {
      return { titel: item.naam, datum: item.datum, regels: item.regels.map((r) => ({ naam: r.naam, hoeveelheid: r.hoeveelheid, eenheid: r.eenheid, kost: r.kost })), extra: item.extra, totaal: item.totaal, item };
    }
    const res = bereken(item);
    return {
      titel: item.naam, datum: null,
      regels: res.regels.map(({ r, g, kost }) => ({ naam: g ? g.naam : 'Verwijderde grondstof', hoeveelheid: r.hoeveelheid || 0, eenheid: r.eenheid, kost })),
      extra: item.extra, totaal: res.totaal, item,
    };
  }

  function tekstVan(item) {
    const m = deelVorm(item);
    const per = perEenheid(m.totaal, item.opbrengstAantal, item.opbrengstEenheid);
    const winkel = vergelijkTekst(vergelijk(m.totaal, item.opbrengstAantal, item.opbrengstEenheid, item.winkelprijs));
    return [
      m.datum ? `${m.titel}, ${datumTekst(m.datum)}` : m.titel,
      '',
      ...m.regels.map((r) => `${r.naam}, ${getal(r.hoeveelheid)} ${r.eenheid}, ${eurFijn(r.kost)}`),
      ...m.extra.map((e) => `${e.naam}, ${eurFijn(e.bedrag)}`),
      '',
      `Totaal ${eur(m.totaal)}`,
      item.opbrengstAantal > 0 ? `Opbrengst ${getal(item.opbrengstAantal)} ${item.opbrengstEenheid}${per.length ? ', ' + per.map((p) => `${p.label.toLowerCase()} ${eurFijn(p.waarde)}`).join(', ') : ''}` : null,
      winkel,
      '',
      'Berekend met Batchkosten van AXISKOM, axiskom.nl',
    ].filter((x) => x !== null).join('\n');
  }

  const kanDelen = typeof navigator.share === 'function';

  /** Deelt als tekst (WhatsApp, mail, notities), of kopieert naar het klembord als delen niet kan. */
  async function deel(item) {
    const tekst = tekstVan(item);
    if (kanDelen) {
      try { await navigator.share({ title: item.naam, text: tekst }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(tekst); toon('Gekopieerd, je kunt het nu plakken waar je wilt.'); } catch (e) { toon('Delen lukt niet op dit toestel.'); }
  }

  /** Print een kaartje van de berekening. Op het scherm blijft het blok verborgen, de opmaak staat in style.css. */
  function drukAf(item) {
    const m = deelVorm(item);
    const per = perEenheid(m.totaal, item.opbrengstAantal, item.opbrengstEenheid);
    const winkel = vergelijkTekst(vergelijk(m.totaal, item.opbrengstAantal, item.opbrengstEenheid, item.winkelprijs));
    document.querySelectorAll('.afdruk-blok').forEach((el) => el.remove());
    const blok = h('div', { class: 'afdruk-blok' },
      h('h1', null, m.titel),
      m.datum ? h('p', null, datumTekst(m.datum)) : null,
      h('table', null,
        m.regels.map((r) => h('tr', null, h('td', null, `${r.naam}, ${getal(r.hoeveelheid)} ${r.eenheid}`), h('td', null, eurFijn(r.kost)))),
        m.extra.map((e) => h('tr', null, h('td', null, e.naam), h('td', null, eurFijn(e.bedrag)))),
        h('tr', { class: 'som' }, h('td', null, 'Totaal'), h('td', null, eur(m.totaal)))),
      item.opbrengstAantal > 0 ? h('p', null, `Opbrengst ${getal(item.opbrengstAantal)} ${item.opbrengstEenheid}${per.length ? ', ' + per.map((p) => `${p.label.toLowerCase()} ${eurFijn(p.waarde)}`).join(', ') : ''}`) : null,
      winkel ? h('p', null, winkel) : null,
      h('p', { class: 'voetnoot' }, 'Berekend met Batchkosten van AXISKOM, axiskom.nl'));
    document.body.append(blok);
    document.body.classList.add('afdrukken');
    window.print();
  }

  /* =====================================================================
     Scherm: Historie
     ===================================================================== */

  let zoekterm = '';

  function viewHistorie(root) {
    const lijstEl = h('div');
    const tekenLijst = () => {
      const q = zoekterm.trim().toLowerCase();
      const batches = [...state.batches]
        .filter((b) => !q || b.naam.toLowerCase().includes(q) || b.receptNaam.toLowerCase().includes(q))
        // Nieuwste eerst, en op dezelfde dag de laatst opgeslagen bovenaan.
        .sort((a, b) => b.datum.localeCompare(a.datum) || state.batches.indexOf(b) - state.batches.indexOf(a));
      lijstEl.replaceChildren(...(batches.length
        ? batches.map(batchKaart)
        : [h('p', { class: 'leeg' }, state.batches.length ? 'Niets gevonden.' : 'Nog geen batches opgeslagen. Rekenen doe je bij Berekenen.')]));
    };

    root.append(h('div', { class: 'kopbalk' },
      h('h2', null, 'Historie'),
      state.batches.length ? h('button', { type: 'button', class: 'knop klein', onclick: exporteerCsv }, 'Exporteer CSV') : null));
    if (state.batches.length > 4) {
      root.append(h('div', { class: 'stapel', style: 'margin-bottom:12px' },
        h('input', { type: 'search', placeholder: 'Zoek op naam…', 'aria-label': 'Zoeken', value: zoekterm, oninput: (e) => { zoekterm = e.target.value; tekenLijst(); } })));
    }
    root.append(lijstEl);
    tekenLijst();
  }

  /** De vorige batch met dezelfde naam, om het prijsverloop te tonen. */
  function vorigeBatch(b) {
    // Op dezelfde dag beslist de volgorde waarin ze zijn opgeslagen.
    const plek = (x) => state.batches.indexOf(x);
    return state.batches
      .filter((x) => x.id !== b.id && x.naam.toLowerCase() === b.naam.toLowerCase() && (x.datum < b.datum || (x.datum === b.datum && plek(x) < plek(b))))
      .sort((x, y) => y.datum.localeCompare(x.datum) || plek(y) - plek(x))[0] || null;
  }

  /** Verandering in procenten, als tekst met teken. */
  const procent = (nieuw, oud) => {
    const p = (nieuw / oud - 1) * 100;
    return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(Math.round(p))}%`;
  };

  function batchKaart(b) {
    const per = perEenheid(b.totaal, b.opbrengstAantal, b.opbrengstEenheid);
    const nu = herbereken(b);
    const verschil = nu - b.totaal;
    const prijzenGewijzigd = Math.abs(verschil) >= 0.005;
    const winkel = vergelijkTekst(vergelijk(b.totaal, b.opbrengstAantal, b.opbrengstEenheid, b.winkelprijs));

    // Verloop ten opzichte van de vorige keer dat je dit maakte.
    let verloop = null;
    const vorige = vorigeBatch(b);
    if (vorige) {
      const vPer = perEenheid(vorige.totaal, vorige.opbrengstAantal, vorige.opbrengstEenheid)[0];
      const gelijk = vPer && per[0] && vPer.label === per[0].label;
      const oud = gelijk ? vPer.waarde : vorige.totaal;
      const nieuw = gelijk ? per[0].waarde : b.totaal;
      if (oud > 0) {
        verloop = h('p', { class: 'muted' }, `Vorige keer ${datumTekst(vorige.datum)} ${eurFijn(oud)}${gelijk ? ' ' + per[0].label.toLowerCase() : ''} `,
          h('span', { class: 'badge ' + (nieuw > oud ? 'waarschuwing' : '') }, procent(nieuw, oud)));
      }
    }

    return h('details', { class: 'item' },
      h('summary', null,
        h('span', null, h('span', { class: 'titel' }, b.naam), h('br'), h('span', { class: 'muted' }, datumTekst(b.datum),
          per[0] ? ` · ${eurFijn(per[0].waarde)} ${per[0].label.toLowerCase()}` : '')),
        h('span', { class: 'bedrag' }, eur(b.totaal))),
      h('div', { class: 'detail' },
        h('table', { class: 'tabel' },
          b.regels.map((r) => h('tr', null, h('td', null, `${r.naam} · ${getal(r.hoeveelheid)} ${r.eenheid}`), h('td', null, eurFijn(r.kost)))),
          b.extra.map((e) => h('tr', null, h('td', null, e.naam), h('td', null, eurFijn(e.bedrag)))),
          h('tr', { class: 'som' }, h('td', null, 'Totaal'), h('td', null, eur(b.totaal)))),
        b.opbrengstAantal ? h('p', { class: 'muted' }, `Opbrengst ${getal(b.opbrengstAantal)} ${b.opbrengstEenheid}${per.length ? ' · ' + per.map((p) => `${p.label.toLowerCase()} ${eurFijn(p.waarde)}`).join(' · ') : ''}`) : null,
        winkel ? h('p', { class: 'muted' }, winkel) : null,
        verloop,
        prijzenGewijzigd
          ? h('p', { class: 'muted' }, 'Met de prijzen van vandaag ', h('span', { class: 'badge ' + (verschil > 0 ? 'waarschuwing' : '') }, `${eur(nu)} (${verschil > 0 ? '+' : '−'}${eur(Math.abs(verschil))})`))
          : null,
        b.notitie ? h('p', { class: 'muted' }, b.notitie) : null),
      h('div', { class: 'acties' },
        h('button', { type: 'button', class: 'knop klein', onclick: () => laadInConcept(conceptVanBatch(b)) }, 'Opnieuw berekenen'),
        h('button', { type: 'button', class: 'knop klein', onclick: () => deel(b) }, kanDelen ? 'Delen' : 'Kopiëren'),
        h('button', { type: 'button', class: 'knop klein', onclick: () => drukAf(b) }, 'Afdrukken'),
        h('button', { type: 'button', class: 'knop klein gevaar', onclick: async () => {
          if (await dialoog({ titel: 'Batch verwijderen?', tekst: `“${b.naam}” van ${datumTekst(b.datum)} verdwijnt uit de historie.`, ok: 'Verwijderen', gevaar: true })) {
            state.batches = state.batches.filter((x) => x.id !== b.id);
            bewaar();
            render();
          }
        } }, 'Verwijderen')));
  }

  /** CSV voor Excel/Sheets: puntkomma-gescheiden, decimale komma, UTF-8 met BOM. */
  function exporteerCsv() {
    const tekst = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // geen formules uitvoeren in het spreadsheet
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const dec = (n) => (n == null ? '' : afronden(n).toFixed(2).replace('.', ','));
    const kop = ['Datum', 'Naam', 'Recept', 'Totaal (EUR)', 'Grondstoffen (EUR)', 'Overig (EUR)', 'Opbrengst', 'Eenheid', 'Kost per eenheid (EUR)', 'Winkelprijs (EUR)', 'Notitie'];
    const rijen = [...state.batches].sort((a, b) => b.datum.localeCompare(a.datum)).map((b) => {
      const per = perEenheid(b.totaal, b.opbrengstAantal, b.opbrengstEenheid)[0];
      return [b.datum, b.naam, b.receptNaam, dec(b.totaal), dec(b.grondKost), dec(b.totaal - b.grondKost),
        b.opbrengstAantal == null ? '' : String(b.opbrengstAantal).replace('.', ','), b.opbrengstAantal ? b.opbrengstEenheid : '',
        per ? String(Math.round(per.waarde * 10000) / 10000).replace('.', ',') : '', dec(b.winkelprijs), b.notitie].map(tekst).join(';');
    });
    downloadBestand(`batchkosten-historie-${vandaag()}.csv`, '\ufeff' + [kop.join(';'), ...rijen].join('\r\n'), 'text/csv;charset=utf-8');
  }

  /* =====================================================================
     Scherm: Recepten
     ===================================================================== */

  function viewRecepten(root) {
    root.append(h('div', { class: 'kopbalk' }, h('h2', null, 'Recepten')));
    if (!state.recepten.length) {
      root.append(h('p', { class: 'leeg' }, 'Nog geen recepten. Stel een berekening samen bij Berekenen en kies “Opslaan als recept”.'));
      return;
    }
    for (const rec of sorteer(state.recepten, (r) => r.naam)) {
      const res = bereken(rec);
      const ontbreekt = res.regels.filter((x) => !x.g).length;
      const winkel = vergelijkTekst(vergelijk(res.totaal, rec.opbrengstAantal, rec.opbrengstEenheid, rec.winkelprijs));
      root.append(h('details', { class: 'item' },
        h('summary', null,
          h('span', null, h('span', { class: 'titel' }, rec.naam), h('br'),
            h('span', { class: 'muted' }, `${rec.regels.length} grondstoffen${res.per[0] ? ` · ${eurFijn(res.per[0].waarde)} ${res.per[0].label.toLowerCase()}` : ''}`)),
          h('span', { class: 'bedrag' }, eur(res.totaal))),
        h('div', { class: 'detail' },
          h('table', { class: 'tabel' },
            res.regels.map(({ r, g, kost }) => h('tr', null,
              h('td', null, `${g ? g.naam : 'Verwijderde grondstof'} · ${getal(r.hoeveelheid || 0)} ${r.eenheid}`),
              h('td', null, g ? eurFijn(kost) : '-'))),
            rec.extra.map((e) => h('tr', null, h('td', null, e.naam), h('td', null, eurFijn(e.bedrag)))),
            h('tr', { class: 'som' }, h('td', null, 'Totaal met prijzen van vandaag'), h('td', null, eur(res.totaal)))),
          winkel ? h('p', { class: 'muted' }, winkel) : null,
          ontbreekt ? h('p', { class: 'muted' }, h('span', { class: 'badge waarschuwing' }, `${ontbreekt} grondstof(fen) bestaan niet meer`)) : null),
        h('div', { class: 'acties' },
          h('button', { type: 'button', class: 'knop klein primair', onclick: () => laadInConcept(conceptVanRecept(rec)) }, 'Gebruik'),
          h('button', { type: 'button', class: 'knop klein', onclick: () => deel(rec) }, kanDelen ? 'Delen' : 'Kopiëren'),
          h('button', { type: 'button', class: 'knop klein gevaar', onclick: async () => {
            if (await dialoog({ titel: 'Recept verwijderen?', tekst: `“${rec.naam}” wordt verwijderd. Opgeslagen batches blijven bestaan.`, ok: 'Verwijderen', gevaar: true })) {
              state.recepten = state.recepten.filter((x) => x.id !== rec.id);
              if (concept.receptId === rec.id) { concept.receptId = null; }
              bewaar();
              render();
            }
          } }, 'Verwijderen'))));
    }
  }

  /* =====================================================================
     Scherm: Instellingen (grondstoffen, categorieën en back-up)
     ===================================================================== */

  let bewerkId = null; // null = geen formulier, 'nieuw' of het id van een grondstof
  let zoekGrondstof = '';

  const GEEN = 'geen'; // sleutel van de groep "Zonder categorie"
  const groepSleutel = (g) => g.categorieId || GEEN;

  /** Inklapbaar blok. Onthoudt, ook na het sluiten van de app, of het open of dicht staat. Met `forceer` staat het altijd open. */
  function inklap(sleutel, kop, inhoud, { standaard = false, klasse = '', forceer = false } = {}) {
    const gewenst = () => (typeof ui.open[sleutel] === 'boolean' ? ui.open[sleutel] : standaard);
    const el = h('details', { class: ('item ' + klasse).trim(), open: forceer || gewenst() }, h('summary', null, kop), inhoud);
    if (!forceer) {
      el.addEventListener('toggle', () => {
        if (el.open !== gewenst()) { ui.open[sleutel] = el.open; bewaarUi(); }
      });
    }
    return el;
  }

  // Wat er gebeurt als het grondstofformulier in Instellingen klaar is.
  const instelOpties = {
    opKlaar: (g) => {
      ui.open[g.categorieId || GEEN] = true; // de groep waar hij staat gaat open
      bewaarUi();
      bewerkId = null;
      toon(`“${g.naam}” opgeslagen.`);
      render();
    },
    opAnnuleer: () => { bewerkId = null; render(); },
  };

  function viewInstellingen(root) {
    const cats = sorteer(state.categorieen, (c) => c.naam);
    if (state.grondstoffen.length <= 6) zoekGrondstof = ''; // zoeken heeft pas zin bij een langere lijst

    root.append(h('div', { class: 'kopbalk' },
      h('h2', null, 'Grondstoffen'),
      bewerkId ? null : h('button', { type: 'button', class: 'knop klein primair', onclick: () => { bewerkId = 'nieuw'; render(); } }, '+ Nieuwe grondstof')));

    if (bewerkId === 'nieuw') root.append(grondstofFormulier(null, instelOpties));

    if (!state.grondstoffen.length) {
      if (!bewerkId) root.append(h('p', { class: 'leeg' }, 'Nog geen grondstoffen. Voeg bv. bloem, gist en zout toe met de prijs van het pakket.'));
    } else {
      const groepenEl = h('div');
      const bulkEl = h('div', { class: 'bulk' });

      const tekenGroepen = () => {
        const q = zoekGrondstof.trim().toLowerCase();
        const zoekt = q.length > 0;
        const pas = (g) => !zoekt || g.naam.toLowerCase().includes(q);
        const alle = [
          ...cats.map((c) => ({ sleutel: c.id, naam: c.naam, items: state.grondstoffen.filter((g) => g.categorieId === c.id) })),
          { sleutel: GEEN, naam: cats.length ? 'Zonder categorie' : 'Alle grondstoffen', items: state.grondstoffen.filter((g) => !g.categorieId) },
        ].filter((gr) => gr.items.length || gr.sleutel !== GEEN);
        // Bij zoeken alleen de groepen met een treffer, en die staan dan open.
        const groepen = alle.map((gr) => ({ ...gr, items: gr.items.filter(pas) })).filter((gr) => !zoekt || gr.items.length);

        bulkEl.replaceChildren();
        if (alle.length > 1 && !zoekt) {
          const zet = (open) => { for (const gr of alle) ui.open[gr.sleutel] = open; bewaarUi(); render(); };
          bulkEl.append(
            h('button', { type: 'button', class: 'knop klein', onclick: () => zet(true) }, 'Alles openklappen'),
            h('button', { type: 'button', class: 'knop klein', onclick: () => zet(false) }, 'Alles dichtklappen'));
        }
        groepenEl.replaceChildren(...(groepen.length
          ? groepen.map((gr) => groepKaart(gr, cats, zoekt))
          : [h('p', { class: 'leeg' }, 'Niets gevonden.')]));
      };

      if (state.grondstoffen.length > 6) {
        root.append(h('div', { class: 'zoekbalk' },
          h('input', { type: 'search', placeholder: 'Zoek grondstof', 'aria-label': 'Zoek grondstof', value: zoekGrondstof, autocomplete: 'off', oninput: (e) => { zoekGrondstof = e.target.value; tekenGroepen(); } })));
      }
      root.append(bulkEl, groepenEl);
      tekenGroepen();
    }

    root.append(categorieBeheer(cats));
    root.append(backupKaart());
    root.append(overKaart());
  }

  function groepKaart(gr, cats, forceer) {
    const n = gr.items.length;
    const inhoud = h('div', { class: 'gitems' },
      n ? sorteer(gr.items, (g) => g.naam).map((g) => (bewerkId === g.id ? grondstofFormulier(g, instelOpties) : grondstofRij(g, cats)))
        : h('p', { class: 'leeg' }, 'Nog geen grondstoffen in deze categorie.'));
    return inklap(gr.sleutel,
      [h('span', { class: 'titel' }, gr.naam), h('span', { class: 'muted' }, `${n} ${n === 1 ? 'grondstof' : 'grondstoffen'}`)],
      inhoud,
      // Zonder categorieën is er maar één groep, die staat dan open.
      { standaard: gr.sleutel === GEEN && !state.categorieen.length, klasse: 'groep', forceer });
  }

  function grondstofRij(g, cats) {
    const p = prijsWeergave(g);
    const w = FAM_WEERGAVE[fam(g.eenheid)];
    const vorige = g.historie && g.historie.length ? g.historie[g.historie.length - 1] : null;
    const verloop = vorige && vorige.pb > 0
      ? h('div', { class: 'muted' }, `Vorige prijs ${eurFijn(vorige.pb * w.factor)} / ${w.eenheid} `,
        h('span', { class: 'badge ' + (prijsPerBasis(g) > vorige.pb ? 'waarschuwing' : '') }, procent(prijsPerBasis(g), vorige.pb)),
        g.prijsDatum ? ` sinds ${datumTekst(g.prijsDatum)}` : '')
      : null;
    const verplaats = cats.length
      ? h('select', { class: 'verplaats', 'aria-label': `Verplaats ${g.naam} naar een categorie`, onchange: (e) => verplaatsNaar(g, e.target.value) },
        h('option', { value: '' }, 'Verplaats naar'),
        cats.filter((c) => c.id !== g.categorieId).map((c) => h('option', { value: c.id }, c.naam)),
        g.categorieId ? h('option', { value: GEEN }, 'Zonder categorie') : null)
      : null;
    return h('div', { class: 'gitem' },
      h('div', { class: 'gkop' },
        h('span', null, h('span', { class: 'titel' }, g.naam), h('br'),
          h('span', { class: 'muted' }, `pakket van ${getal(g.inhoud)} ${g.eenheid} voor ${eur(g.prijs)}${g.gramPerEl > 0 ? `, 1 el is ${getal(g.gramPerEl)} g` : ''}`)),
        h('span', { class: 'bedrag' }, `${eurFijn(p.bedrag)} / ${p.eenheid}`)),
      verloop,
      h('div', { class: 'acties' },
        h('button', { type: 'button', class: 'knop klein', onclick: () => { bewerkId = g.id; ui.open[groepSleutel(g)] = true; bewaarUi(); render(); } }, 'Bewerken'),
        verplaats,
        h('button', { type: 'button', class: 'knop klein gevaar', onclick: () => verwijderGrondstof(g) }, 'Verwijderen')));
  }

  function verplaatsNaar(g, waarde) {
    if (!waarde) return;
    const cat = state.categorieen.find((c) => c.id === waarde);
    if (waarde !== GEEN && !cat) return;
    g.categorieId = cat ? cat.id : null;
    ui.open[groepSleutel(g)] = true; // zo zie je meteen waar hij terecht is gekomen
    bewaarUi();
    bewaar();
    toon(`“${g.naam}” verplaatst naar ${cat ? cat.naam : 'Zonder categorie'}`);
    render();
  }

  /* ---- Categorieën ---- */

  function categorieBeheer(cats) {
    const invoer = h('input', { type: 'text', maxlength: 60, placeholder: 'bv. Bakken, Koken', 'aria-label': 'Naam van de nieuwe categorie' });
    const form = h('form', { class: 'catvoeg' }, invoer, h('button', { type: 'submit', class: 'knop primair' }, 'Toevoegen'));
    form.addEventListener('submit', (e) => { e.preventDefault(); voegCategorieToe(invoer.value); });

    const rijen = cats.map((c) => {
      const n = state.grondstoffen.filter((g) => g.categorieId === c.id).length;
      return h('div', { class: 'catrij' },
        h('span', null, h('span', { class: 'titel' }, c.naam), ' ', h('span', { class: 'muted' }, `(${n})`)),
        h('span', { class: 'rijknoppen' },
          h('button', { type: 'button', class: 'knop klein', onclick: () => hernoemCategorie(c) }, 'Hernoemen'),
          h('button', { type: 'button', class: 'knop klein gevaar', onclick: () => verwijderCategorie(c) }, 'Verwijderen')));
    });

    return inklap('beheer',
      [h('span', { class: 'titel' }, 'Categorieën beheren'), h('span', { class: 'muted' }, cats.length ? `${cats.length} ${cats.length === 1 ? 'categorie' : 'categorieën'}` : 'nog geen')],
      h('div', { class: 'inhoud' },
        h('p', { class: 'muted' }, 'Met categorieën houd je een lange lijst grondstoffen overzichtelijk, bijvoorbeeld Bakken of Koken. Een grondstof verplaats je met de keuzelijst bij de grondstof zelf.'),
        form,
        rijen));
  }

  function voegCategorieToe(ruw) {
    const naam = ruw.trim();
    if (!naam) { toon('Geef de categorie een naam.'); return; }
    if (state.categorieen.some((c) => c.naam.toLowerCase() === naam.toLowerCase())) { toon(`“${naam}” bestaat al.`); return; }
    state.categorieen.push({ id: uid(), naam });
    ui.open.beheer = true;
    bewaarUi();
    bewaar();
    toon(`Categorie “${naam}” toegevoegd.`);
    render();
    // Meteen verder kunnen typen voor de volgende categorie.
    setTimeout(() => { const veld = document.querySelector('.catvoeg input'); if (veld) veld.focus(); }, 0);
  }

  async function hernoemCategorie(c) {
    const naam = await dialoog({ titel: 'Categorie hernoemen', invoer: true, waarde: c.naam, ok: 'Opslaan' });
    if (!naam || naam === c.naam) return;
    if (state.categorieen.some((x) => x.id !== c.id && x.naam.toLowerCase() === naam.toLowerCase())) { toon(`“${naam}” bestaat al.`); return; }
    c.naam = naam.slice(0, 60);
    bewaar();
    render();
  }

  async function verwijderCategorie(c) {
    const n = state.grondstoffen.filter((g) => g.categorieId === c.id).length;
    const tekst = n
      ? `De ${n} ${n === 1 ? 'grondstof' : 'grondstoffen'} in “${c.naam}” gaan naar Zonder categorie. Er wordt geen grondstof verwijderd.`
      : `“${c.naam}” wordt verwijderd.`;
    if (!(await dialoog({ titel: 'Categorie verwijderen?', tekst, ok: 'Verwijderen', gevaar: true }))) return;
    for (const g of state.grondstoffen) if (g.categorieId === c.id) g.categorieId = null;
    state.categorieen = state.categorieen.filter((x) => x.id !== c.id);
    delete ui.open[c.id];
    bewaarUi();
    bewaar();
    render();
  }

  function overKaart() {
    return inklap('over', h('span', { class: 'titel' }, 'Over deze tool'),
      h('div', { class: 'inhoud over' },
        h('p', null, 'Batchkosten is gemaakt door AXISKOM, voor iedereen die thuis brood bakt, worst maakt of kaas maakt en wil weten wat een batch echt kost.'),
        h('p', { class: 'muted' }, 'Je gegevens blijven op je eigen toestel. Er is geen account, geen server en geen tracking.')));
  }

  async function verwijderGrondstof(g) {
    const inRecepten = state.recepten.filter((r) => r.regels.some((x) => x.grondstofId === g.id)).length;
    const tekst = inRecepten
      ? `“${g.naam}” zit in ${inRecepten} recept(en). Die houden een lege regel over. Opgeslagen batches blijven ongewijzigd.`
      : `“${g.naam}” wordt verwijderd. Opgeslagen batches blijven ongewijzigd.`;
    if (!(await dialoog({ titel: 'Grondstof verwijderen?', tekst, ok: 'Verwijderen', gevaar: true }))) return;
    state.grondstoffen = state.grondstoffen.filter((x) => x.id !== g.id);
    bewaar();
    render();
  }

  /**
   * Formulier om een grondstof toe te voegen of te bewerken. Het bewaren zit hier, wat er daarna gebeurt
   * regelen `opKlaar(grondstof)` en `opAnnuleer()`. Zo werkt het zowel in Instellingen als in een dialoog.
   */
  function grondstofFormulier(g, { voorNaam = '', inDialoog = false, opKlaar, opAnnuleer } = {}) {
    const naamIn = h('input', { type: 'text', required: true, maxlength: 80, placeholder: 'bv. Bloem T65', value: g ? g.naam : voorNaam });
    const prijsIn = h('input', { type: 'text', inputmode: 'decimal', required: true, placeholder: 'bv. 1,20', value: g ? naarInvoer(g.prijs) : '' });
    const inhoudIn = h('input', { type: 'text', inputmode: 'decimal', required: true, placeholder: 'bv. 1', value: g ? naarInvoer(g.inhoud) : '' });
    const eenheidSel = h('select', { value: g ? g.eenheid : 'kg' }, PAKKET_EENHEDEN.map((e) => h('option', { value: e }, e)));
    const elIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'bv. 18', value: g && g.gramPerEl > 0 ? naarInvoer(g.gramPerEl) : '' });
    const elVeld = h('label', { class: 'veld' }, 'Gewicht van 1 eetlepel in gram (optioneel)', elIn,
      h('span', { class: 'muted' }, 'Zo kun je bij Berekenen ook met eetlepels en theelepels rekenen. Zout is bijvoorbeeld ongeveer 18 g per eetlepel.'));
    const cats = sorteer(state.categorieen, (c) => c.naam);
    const catSel = cats.length
      ? h('select', { value: g && g.categorieId ? g.categorieId : '' },
        h('option', { value: '' }, 'Zonder categorie'),
        cats.map((c) => h('option', { value: c.id }, c.naam)))
      : null;
    const voorbeeld = h('p', { class: 'muted' });

    const isMassa = () => fam(eenheidSel.value) === 'massa';
    const lees = () => ({
      naam: naamIn.value.trim(), prijs: parseGetal(prijsIn.value), inhoud: parseGetal(inhoudIn.value), eenheid: eenheidSel.value,
      categorieId: catSel ? catSel.value || null : (g ? g.categorieId || null : null),
      gramPerEl: isMassa() && parseGetal(elIn.value) > 0 ? parseGetal(elIn.value) : null,
    });
    const toonVoorbeeld = () => {
      const v = lees();
      elVeld.hidden = !isMassa();
      if (v.prijs != null && v.prijs >= 0 && v.inhoud > 0) {
        const p = prijsWeergave(v);
        voorbeeld.textContent = `= ${eurFijn(p.bedrag)} per ${p.eenheid}`;
      } else voorbeeld.textContent = 'Vul de prijs en de inhoud van het pakket in.';
    };
    for (const el of [naamIn, prijsIn, inhoudIn]) el.addEventListener('input', toonVoorbeeld);
    eenheidSel.addEventListener('change', toonVoorbeeld);
    toonVoorbeeld();

    const form = h('form', { class: inDialoog ? 'dlg-form' : 'card stapel', novalidate: true },
      h('h3', null, g ? 'Grondstof bewerken' : 'Nieuwe grondstof'),
      h('label', { class: 'veld' }, 'Naam', naamIn),
      h('div', { class: 'rij2' },
        h('label', { class: 'veld' }, 'Prijs per pakket (€)', prijsIn),
        h('label', { class: 'veld' }, 'Inhoud van het pakket', inhoudIn)),
      h('label', { class: 'veld' }, 'Eenheid van de inhoud', eenheidSel),
      elVeld,
      catSel ? h('label', { class: 'veld' }, 'Categorie', catSel) : null,
      voorbeeld,
      h('div', { class: inDialoog ? 'dlg-knoppen' : 'knoppen' },
        h('button', { type: 'button', class: 'knop', onclick: () => opAnnuleer() }, 'Annuleren'),
        h('button', { type: 'submit', class: 'knop primair' }, 'Opslaan')));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = lees();
      if (!v.naam) { toon('Geef de grondstof een naam.'); naamIn.focus(); return; }
      if (v.prijs == null || v.prijs < 0) { toon('Vul een geldige prijs in.'); prijsIn.focus(); return; }
      if (!(v.inhoud > 0)) { toon('Vul de inhoud van het pakket in (meer dan 0).'); inhoudIn.focus(); return; }
      if (state.grondstoffen.some((x) => x.id !== (g && g.id) && x.naam.toLowerCase() === v.naam.toLowerCase())) {
        toon(`“${v.naam}” bestaat al.`); naamIn.focus(); return;
      }
      let opgeslagen;
      if (g) {
        const oudeFam = fam(g.eenheid);
        const oudePb = prijsPerBasis(g);
        Object.assign(g, v);
        noteerPrijswijziging(g, oudeFam, oudePb);
        opgeslagen = g;
      } else {
        opgeslagen = { id: uid(), ...v, prijsDatum: vandaag(), historie: [] };
        state.grondstoffen.push(opgeslagen);
      }
      bewaar();
      opKlaar(opgeslagen);
    });
    setTimeout(() => (g || !voorNaam ? naamIn : prijsIn).focus(), 0);
    return form;
  }

  /** Onthoudt de vorige prijs als de prijs per g, ml of stuk veranderd is, zodat je het verloop ziet. */
  function noteerPrijswijziging(g, oudeFam, oudePb) {
    if (fam(g.eenheid) !== oudeFam) { g.historie = []; g.prijsDatum = vandaag(); return; }
    const nieuwePb = prijsPerBasis(g);
    if (Math.abs(nieuwePb - oudePb) <= 1e-12 * Math.max(1, Math.abs(oudePb))) return;
    g.historie = [...(g.historie || []), { datum: g.prijsDatum || '', pb: oudePb }].slice(-20);
    g.prijsDatum = vandaag();
  }

  /* ---- Back-up ---- */

  const kanBestandDelen = typeof navigator.canShare === 'function' && typeof navigator.share === 'function';

  function backupKaart() {
    const dagen = state.laatsteBackup ? Math.floor((Date.now() - Date.parse(state.laatsteBackup)) / 86400000) : null;
    const heeftData = state.grondstoffen.length || state.batches.length || state.recepten.length;
    const verouderd = dagen !== null && dagen > 30 && heeftData;
    // Een back-up is een gewoon tekstbestand (.txt). Oudere back-ups als .json lezen we ook nog.
    const bestandIn = h('input', { type: 'file', accept: '.txt,.json,text/plain,application/json', hidden: true, onchange: (e) => importeer(e.target.files[0]) });

    // De status staat al in de kop, zodat je ook ingeklapt ziet of een back-up nodig is.
    const status = state.laatsteBackup
      ? h('span', { class: verouderd ? 'badge waarschuwing' : 'muted' }, verouderd ? 'tijd voor een nieuwe' : `laatste op ${datumTekst(state.laatsteBackup.slice(0, 10))}`)
      : h('span', { class: heeftData ? 'badge waarschuwing' : 'muted' }, 'nog geen back-up');

    return inklap('backup', [h('span', { class: 'titel' }, 'Back-up'), status],
      h('div', { class: 'inhoud' },
        h('p', { class: 'muted' }, 'Je gegevens staan alleen in deze browser, op dit toestel. Wis je de browserdata of wissel je van toestel, dan heb je het back-upbestand nodig. Dat is een gewoon tekstbestand (.txt). Bewaar het goed en pas het niet aan.'),
        kanBestandDelen
          ? h('p', { class: 'muted' }, 'Kies bij Back-up delen bijvoorbeeld Google Drive, WhatsApp of e-mail, dan staat het bestand ook buiten je toestel veilig.')
          : null,
        h('div', { class: 'knoppen' },
          kanBestandDelen ? h('button', { type: 'button', class: 'knop primair', onclick: deelBackup }, 'Back-up delen') : null,
          h('button', { type: 'button', class: kanBestandDelen ? 'knop' : 'knop primair', onclick: exporteerBackup }, 'Back-up downloaden'),
          h('button', { type: 'button', class: 'knop', onclick: () => bestandIn.click() }, 'Back-up terugzetten'),
          bestandIn)));
  }

  function backupInhoud() {
    state.laatsteBackup = new Date().toISOString();
    return JSON.stringify(state, null, 2);
  }

  function exporteerBackup() {
    const json = backupInhoud();
    bewaar();
    downloadBestand(`batchkosten-backup-${vandaag()}.txt`, json, 'text/plain;charset=utf-8');
    render();
  }

  /**
   * Stuurt de back-up via het deelmenu van het toestel (Drive, WhatsApp, mail, Bestanden).
   * Het is een .txt, want dat type accepteren bijna alle toestellen en apps, een .json vaak niet.
   */
  async function deelBackup() {
    const vorige = state.laatsteBackup;
    const json = backupInhoud();
    const naam = `batchkosten-backup-${vandaag()}.txt`;
    const bestand = new File([json], naam, { type: 'text/plain' });
    if (navigator.canShare({ files: [bestand] })) {
      try {
        await navigator.share({ files: [bestand], title: 'Batchkosten back-up' });
        bewaar();
        render();
        return;
      } catch (e) {
        state.laatsteBackup = vorige;
        if (e && e.name === 'AbortError') return; // je hebt het delen zelf geannuleerd
      }
    }
    bewaar();
    downloadBestand(naam, json, 'text/plain;charset=utf-8');
    toon('Delen lukt hier niet, het bestand is gedownload.');
    render();
  }

  async function importeer(bestand) {
    if (!bestand) return;
    let nieuw;
    try {
      if (bestand.size > 20 * 1024 * 1024) throw new Error('Het bestand is te groot.');
      nieuw = schoon(JSON.parse(await bestand.text()));
    } catch (e) {
      const tekst = e instanceof SyntaxError ? 'Dit is geen back-upbestand van Batchkosten.' : (e.message || 'Dit bestand kan niet gelezen worden.');
      await dialoog({ titel: 'Terugzetten mislukt', tekst, ok: 'OK', annuleer: null });
      return;
    }
    const samen = `${nieuw.grondstoffen.length} grondstoffen, ${nieuw.recepten.length} recepten, ${nieuw.batches.length} batches`;
    if (!(await dialoog({ titel: 'Back-up terugzetten?', tekst: `Het bestand bevat ${samen}. Alles wat je nu in de tool hebt, wordt vervangen.`, ok: 'Terugzetten', gevaar: true }))) return;
    state = nieuw;
    concept = nieuwConcept();
    bewaar();
    bewerkId = null;
    toon('Back-up teruggezet.');
    render();
  }

  function downloadBestand(naam, inhoud, type) {
    const url = URL.createObjectURL(new Blob([inhoud], { type }));
    const a = h('a', { href: url, download: naam });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- Start ---------- */

  window.addEventListener('hashchange', () => { bewerkId = null; render(); });
  render();

  // Vraag de browser de gegevens niet zomaar op te ruimen bij weinig opslagruimte.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
