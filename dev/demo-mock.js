/* MODO DEMOSTRACIÓN: sustituye a las funciones de Netlify y a Airtable dentro del propio navegador.
   Los cambios se guardan solo en este navegador (localStorage). Nada sale de tu ordenador. */
(function () {
  const KEY = "comercial-volta-demo-db-v1";
  const L = window.__DEMO_LISTS, SEED = window.__DEMO_SEED;
  const now = () => new Date().toISOString();
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const rid = () => "rec" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { db = null; }
  if (!db) db = JSON.parse(JSON.stringify(SEED));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
  window.__resetDemo = () => { localStorage.removeItem(KEY); localStorage.removeItem("comercial-volta-token"); location.reload(); };

  class Err extends Error { constructor(s, m) { super(m); this.status = s; } }
  const ok = b => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  const fail = e => new Response(JSON.stringify({ error: e.message }), { status: e.status || 500, headers: { "content-type": "application/json" } });
  const session = h => { const t = (h || "").replace(/^Bearer /, ""); try { return JSON.parse(decodeURIComponent(escape(atob(t)))); } catch (e) { return null; } };
  const find = (id, s) => { const l = db.leads.find(x => x.id === id); if (!l) throw new Err(404, "Lead no encontrado"); if (s.role !== "admin" && l.comercial !== s.name) throw new Err(403, "Este lead no es tuyo."); return l; };
  const digits = s => String(s || "").replace(/\D/g, "");
  const pk = s => { const d = digits(s); return d.length >= 6 ? d.slice(-9) : ""; };
  const ek = s => String(s || "").toLowerCase().split(/[\s,;/]+/).filter(x => /.+@.+\..+/.test(x));
  const ck = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const nk = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)/g, "").replace(/\b(s\.?l\.?u?|s\.?a\.?|grupo|espana|portugal)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const idx = s => L.STAGES.indexOf(s);
  function stage(l, estado, motivo, detalle, s) {
    const before = l.estado;
    if (estado === "Perdido") { if (!L.LOSS.includes(motivo)) throw new Err(400, "Para marcar un lead como «Perdido» hay que elegir el motivo."); l.motivo = motivo; l.motivoDetalle = detalle || ""; }
    else { l.motivo = ""; l.motivoDetalle = ""; }
    const closed = x => x === "Ganado" || x === "Perdido" || x === "No interesado";
    const dead = x => x === "Perdido" || x === "No interesado";
    if (closed(estado) && !(closed(before) && l.cierre)) l.cierre = today();
    if (!closed(estado)) l.cierre = null;
    const curMax = l.etapaMax || (!dead(before) ? before : "Nuevo");
    if (!dead(estado)) l.etapaMax = idx(estado) > idx(curMax) ? estado : curMax; else l.etapaMax = curMax;
    if (estado !== "Nuevo" && !l.primerContacto) l.primerContacto = now();
    l.estado = estado;
    if (before !== estado && s) l.acts.unshift({ id: rid(), lead: l.id, tipo: "Cambio de estado", fecha: now(), resultado: "", texto: estado === "Perdido" ? "Motivo: " + motivo + (detalle ? " · " + detalle : "") : "", contacto: "", comercial: s.name, origen: "Manual", resumen: `Estado: ${before} → ${estado}` });
  }
  const pick = (v, list) => list.includes(v) ? v : "";
  function applyFields(l, b, s, isNew) {
    const str = v => String(v ?? "").trim();
    if ("empresa" in b) { if (!str(b.empresa)) throw new Err(400, "Falta el nombre de la empresa o del cliente."); l.empresa = str(b.empresa); }
    ["grupo", "provincia", "ciudad", "notas", "accionNota", "holdedId", "kommoId", "clickup"].forEach(k => { if (k in b) l[k] = str(b[k]); });
    if ("web" in b) l.web = str(b.web) && !/^https?:/i.test(str(b.web)) ? "https://" + str(b.web) : str(b.web);
    if ("cif" in b) l.cif = str(b.cif).toUpperCase();
    if ("pais" in b) l.pais = pick(b.pais, L.COUNTRIES);
    if ("tipo" in b) l.tipo = pick(b.tipo, L.TYPES);
    if ("linea" in b) l.linea = pick(b.linea, L.LINES);
    if ("origen" in b) l.origen = pick(b.origen, L.ORIGINS);
    if ("potencial" in b) l.potencial = pick(b.potencial, L.POTENTIAL);
    if ("productos" in b) l.productos = (b.productos || []).filter(p => [...L.PRODUCTS.Litio, ...L.PRODUCTS.Plomo].includes(p));
    if ("marcas" in b) l.marcas = (b.marcas || []).filter(p => L.BRANDS.includes(p));
    if ("valor" in b) l.valor = Math.max(0, Math.round(Number(b.valor) || 0));
    if ("prob" in b) l.prob = b.prob === null || b.prob === "" ? null : Math.min(100, Math.max(0, Math.round(Number(b.prob) || 0)));
    if ("accion" in b) { l.accion = pick(b.accion, L.ACTIONS); l.accionFecha = l.accion ? (b.accionFecha || null) : null; if (!l.accion) l.accionNota = ""; }
    if ("adjuntos" in b) l.adjuntos = (b.adjuntos || []).map(a => ({ id: a.id || rid(), url: a.url, name: a.name, contentType: a.contentType || "" }));
    if (s.role === "admin") { if ("comercial" in b || isNew) { const names = db.users.filter(u => u.active).map(u => u.name); l.comercial = names.includes(b.comercial) ? b.comercial : (isNew ? (db.users.find(u => u.role === "sales" && u.active) || {}).name || "" : ""); } }
    else if (isNew) l.comercial = s.name;
  }
  const blank = () => ({ id: rid(), empresa: "", grupo: "", pais: "", provincia: "", ciudad: "", web: "", cif: "", tipo: "", linea: "", origen: "", productos: [], marcas: [], potencial: "", valor: 0, prob: null, estado: "Nuevo", etapaMax: "Nuevo", motivo: "", motivoDetalle: "", accion: "", accionFecha: null, accionNota: "", comercial: "", notas: "", adjuntos: [], alta: now(), primerContacto: null, cierre: null, ref: null, holdedId: "", kommoId: "", clickup: "", contacts: [], acts: [] });
  function saveContacts(l, list) {
    if (!Array.isArray(list)) return;
    for (const c of list) {
      const i = c.id ? l.contacts.findIndex(x => x.id === c.id) : -1;
      if (c._delete) { if (i >= 0) l.contacts.splice(i, 1); continue; }
      if (!c.nombre && !c.tel && !c.email) continue;
      const v = { id: c.id || rid(), lead: l.id, nombre: c.nombre || "Contacto", cargo: c.cargo || "", area: c.area || "", tel: c.tel || "", email: c.email || "", principal: !!c.principal };
      if (i >= 0) l.contacts[i] = v; else l.contacts.push(v);
    }
  }
  function dupes(b) {
    const out = new Map(); const add = (l, w) => { if (l.id === b.excludeId) return; const h = out.get(l.id) || { id: l.id, empresa: l.empresa, comercial: l.comercial, estado: l.estado, why: [] }; if (!h.why.includes(w)) h.why.push(w); out.set(l.id, h); };
    const p = pk(b.tel), e = ek(b.email), c = ck(b.cif), n = nk(b.empresa);
    for (const l of db.leads) {
      if (c.length >= 5 && ck(l.cif) === c) add(l, "CIF");
      if (n.length >= 4 && nk(l.empresa) === n) add(l, "nombre");
      for (const x of l.contacts) { if (p && pk(x.tel) === p) add(l, "teléfono"); if (e.length && ek(x.email).some(y => e.includes(y))) add(l, "email"); }
    }
    return [...out.values()];
  }

  async function api(name, method, body, auth) {
    await new Promise(r => setTimeout(r, 120));
    if (name === "login") {
      const u = db.users.find(x => x.active && x.code === String(body.code));
      if (!u) throw new Err(401, "Código incorrecto. En la demo: 111111 (Jaime) o 222222 (Ángel).");
      const ses = { role: u.role, who: u.id, name: u.name };
      return { token: btoa(unescape(encodeURIComponent(JSON.stringify(ses)))), ...ses };
    }
    const s = session(auth); if (!s) throw new Err(401, "Sesión caducada");
    const admin = () => { if (s.role !== "admin") throw new Err(403, "Solo el administrador puede hacer esto."); };
    if (name === "upload") return { id: rid(), url: "data:" + (body.contentType || "application/octet-stream") + ";base64," + body.data, name: body.filename, contentType: body.contentType };
    if (name === "ai") {
      const m = String(body.prompt).match(/"""\n([\s\S]*?)\n"""/); const t = (m ? m[1] : "").trim();
      const low = t.toLowerCase();
      const res = /no (le )?interesa|no quiere/.test(low) ? "No interesado" : /no contesta|no coge/.test(low) ? "No contesta" : /presupuesto|precio|interes/.test(low) ? "Interesado" : "Hablado";
      const d = new Date(); let n = 0; while (n < 3) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n++; }
      const f = d.toISOString().slice(0, 10);
      const txt = t.replace(/\b(eh+|pues|vale vale|o sea|bueno)\b[,]?\s*/gi, "").replace(/\s+/g, " ").replace(/^./, c => c.toUpperCase());
      return { text: JSON.stringify({ texto: txt + "\n\n(Demostración: en la versión real lo ordena Claude)", resultado: res, proxima_accion: { tipo: /presupuesto|precio/.test(low) ? "Enviar presupuesto" : "Llamar", fecha: f, nota: "Seguimiento de lo hablado" } }) };
    }
    if (method === "GET") {
      const leads = db.leads.filter(l => s.role === "admin" || l.comercial === s.name);
      leads.forEach(l => l.acts.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))));
      return { session: s, leads: JSON.parse(JSON.stringify(leads)), users: db.users.map(u => ({ rid: u.rid, id: u.id, name: u.name, role: u.role, active: u.active, hasCode: true })), lists: L, aiEnabled: true };
    }
    const out = (() => { switch (body.action) {
      case "saveLead": {
        const isNew = !body.id; const l = isNew ? blank() : find(body.id, s);
        applyFields(l, body.lead || {}, s, isNew);
        const est = L.STAGES.includes((body.lead || {}).estado) ? body.lead.estado : l.estado;
        if (est !== l.estado || est === "Perdido") stage(l, est, body.lead.motivo ?? l.motivo, body.lead.motivoDetalle ?? l.motivoDetalle, isNew ? null : s);
        saveContacts(l, body.contacts); if (isNew) db.leads.push(l);
        return { id: l.id, lead: { ...l } };
      }
      case "moveLead": { const l = find(body.id, s); stage(l, body.estado, body.motivo, body.motivoDetalle, s); if (!L.OPEN.includes(body.estado)) { l.accion = ""; l.accionFecha = null; l.accionNota = ""; } return { id: l.id, lead: { ...l } }; }
      case "setNext": { const l = find(body.id, s); l.accion = pick(body.accion, L.ACTIONS); l.accionFecha = l.accion ? body.fecha : null; l.accionNota = l.accion ? (body.nota || "") : ""; return { id: l.id, lead: { ...l } }; }
      case "addActivity": {
        const l = find(body.leadId, s); const tipo = L.ACT_TYPES.includes(body.tipo) ? body.tipo : "Nota";
        if (!body.texto && !body.resultado) throw new Err(400, "Escribe qué ha pasado o elige un resultado.");
        const a = { id: rid(), lead: l.id, tipo, fecha: now(), resultado: body.resultado || "", texto: body.texto || "", contacto: body.contacto || "", comercial: s.name, origen: "Manual", resumen: tipo + (body.resultado ? " · " + body.resultado : "") };
        l.acts.unshift(a);
        if (tipo !== "Nota") { if (!l.primerContacto) l.primerContacto = now(); if (l.estado === "Nuevo") stage(l, "Contactado", null, null, s); }
        if (body.next && L.ACTIONS.includes(body.next.accion)) { l.accion = body.next.accion; l.accionFecha = body.next.fecha; l.accionNota = body.next.nota || ""; }
        return { id: l.id, lead: { ...l }, act: a };
      }
      case "deleteActivity": { for (const l of db.leads) { const i = l.acts.findIndex(a => a.id === body.id); if (i >= 0) { if (s.role !== "admin" && l.acts[i].comercial !== s.name) throw new Err(403, "Solo puedes borrar tus propias anotaciones."); l.acts.splice(i, 1); } } return { ok: true }; }
      case "dupes": return { dupes: dupes(body) };
      case "deleteLead": admin(); db.leads = db.leads.filter(l => l.id !== body.id); return { ok: true };
      case "reassign": admin(); db.leads.forEach(l => { if (body.ids.includes(l.id)) l.comercial = body.comercial; }); return { ok: true };
      case "importLeads": {
        admin();
        for (const r of body.rows) { const l = blank(); applyFields(l, { ...r, accion: "" }, s, true); if (!l.origen) l.origen = "Prospección comercial"; saveContacts(l, (r.contacto || r.tel || r.email) ? [{ nombre: r.contacto, cargo: r.cargo, tel: r.tel, email: r.email, principal: true }] : []); db.leads.push(l); }
        return { ok: true, created: body.rows.length };
      }
      case "saveUser": {
        admin(); const u = body.user || {};
        if (u.code && !/^\d{6}$/.test(u.code)) throw new Err(400, "El código tiene que tener exactamente 6 números.");
        if (u.code && db.users.some(x => x.code === u.code && x.rid !== u.rid)) throw new Err(409, "Ese código ya lo usa otra persona.");
        if (u.rid) { const x = db.users.find(y => y.rid === u.rid); if (u.code) x.code = u.code; if (x.role !== "admin") x.active = u.active !== false; }
        else { if (!u.name || !u.code) throw new Err(400, "Falta el nombre o el código."); db.users.push({ rid: rid(), id: u.name.toLowerCase().replace(/[^a-z0-9]/g, ""), name: u.name, role: "sales", active: true, code: u.code }); }
        return { ok: true };
      }
      default: throw new Err(400, "Acción desconocida");
    } })();
    save(); return JSON.parse(JSON.stringify(out));
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    const m = String(url).match(/\/\.netlify\/functions\/(\w+)/);
    if (!m) return realFetch(url, opts);
    try { const body = opts.body ? JSON.parse(opts.body) : {}; return ok(await api(m[1], (opts.method || "GET").toUpperCase(), body, (opts.headers || {}).authorization)); }
    catch (e) { return fail(e); }
  };
})();
