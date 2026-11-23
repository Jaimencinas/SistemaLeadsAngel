// Datos del CRM.
//   GET  = cargar todo lo que puede ver quien entra (el comercial solo recibe sus propios leads).
//   POST = acciones { action: "...", ... }. Las de administrador están marcadas.
import {
  handler, json, HttpError, requireAuth, at, listAll, getRecord, createRecord, updateRecord, deleteRecord, createMany, deleteMany,
  getUsers, codeHash, ENV, T, LISTS, STAGES, OPEN, LOSS, ACTIONS, ACT_TYPES, RESULTS, LINES, COUNTRIES, TYPES, ORIGINS, POTENTIAL, PRODUCTS, BRANDS,
  str, oneOf, date, phoneKey, emailKeys, cifKey,
} from "../lib/common.mjs";

const ALL_PRODUCTS = [...PRODUCTS.Litio, ...PRODUCTS.Plomo];
const att = a => ({ id: a.id, url: a.url, name: a.filename, contentType: a.type || "", size: a.size || 0 });
const link = v => Array.isArray(v) ? v[0] : null;

/* ---------- registro de Airtable -> objeto de la web ---------- */
function leadOut(r) {
  const f = r.fields || {};
  return {
    id: r.id, empresa: f.Empresa || "Sin nombre", grupo: f.Grupo || "", pais: f["País"] || "", provincia: f.Provincia || "", ciudad: f.Ciudad || "",
    web: f.Web || "", cif: f.CIF || "", tipo: f["Tipo de cliente"] || "", linea: f["Línea"] || "", origen: f.Origen || "",
    productos: f.Productos || [], marcas: f.Marcas || [], potencial: f.Potencial || "",
    valor: Number(f["Valor estimado"]) || 0, prob: f.Probabilidad == null ? null : Number(f.Probabilidad),
    estado: f.Estado || "Nuevo", etapaMax: f["Etapa máxima"] || "", motivo: f["Motivo pérdida"] || "", motivoDetalle: f["Detalle pérdida"] || "",
    accion: f["Próxima acción"] || "", accionFecha: f["Fecha próxima acción"] || null, accionNota: f["Nota próxima acción"] || "",
    comercial: f.Comercial || "", notas: f.Notas || "", adjuntos: (f.Adjuntos || []).map(att),
    alta: f["Fecha alta"] || r.createdTime || null, primerContacto: f["Primer contacto"] || null, cierre: f["Fecha cierre"] || null,
    ref: f["Ref Excel"] || null, holdedId: f["Holded ID"] || "", kommoId: f["Kommo ID"] || "", clickup: f.ClickUp || "",
    contacts: [], acts: [],
  };
}
function contactOut(r) {
  const f = r.fields || {};
  return { id: r.id, lead: link(f.Empresa), nombre: f.Nombre || "", cargo: f.Cargo || "", area: f["Área"] || "", tel: f["Teléfono"] || "", email: f.Email || "", principal: !!f.Principal };
}
function actOut(r) {
  const f = r.fields || {};
  return { id: r.id, lead: link(f.Empresa), tipo: f.Tipo || "Nota", fecha: f.Fecha || r.createdTime, resultado: f.Resultado || "", texto: f.Texto || "",
    contacto: f.Contacto || "", comercial: f.Comercial || "", origen: f.Origen || "Manual", resumen: f.Resumen || "" };
}

/* ---------- permisos ---------- */
async function loadLead(id, s) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(String(id || ""))) throw new HttpError(400, "Lead no válido");
  const r = await getRecord(T.leads, id);
  if (s.role !== "admin" && (r.fields?.Comercial || "") !== s.name) throw new HttpError(403, "Este lead no es tuyo.");
  return r;
}

/* ---------- reglas del embudo ----------
   - «Perdido» exige motivo.
   - Al cerrar (Ganado/Perdido) se guarda la fecha de cierre; si se reabre, se borra.
   - «Etapa máxima» recuerda hasta dónde llegó (para la conversión del embudo).
   - Salir de «Nuevo» marca el primer contacto si aún no lo tenía. */
const stageIdx = s => STAGES.indexOf(s);
function stageFields(prev, estado, motivo, detalle) {
  const out = {};
  const before = prev["Estado"] || "Nuevo";
  if (estado === "Perdido") {
    const m = oneOf(motivo, LOSS);
    if (!m) throw new HttpError(400, "Para marcar un lead como «Perdido» hay que elegir el motivo.");
    out["Motivo pérdida"] = m; out["Detalle pérdida"] = str(detalle, 300);
  } else { out["Motivo pérdida"] = null; out["Detalle pérdida"] = ""; }
  out.Estado = estado;
  const closed = x => x === "Ganado" || x === "Perdido";
  if (closed(estado) && !(closed(before) && prev["Fecha cierre"])) out["Fecha cierre"] = new Date().toISOString().slice(0, 10);
  if (!closed(estado)) out["Fecha cierre"] = null;
  if (estado !== "Perdido") {
    const curMax = prev["Etapa máxima"] || (before !== "Perdido" ? before : "Nuevo");
    out["Etapa máxima"] = stageIdx(estado) > stageIdx(curMax) ? estado : curMax;
  } else if (!prev["Etapa máxima"]) out["Etapa máxima"] = before !== "Perdido" ? before : "Nuevo";
  if (estado !== "Nuevo" && !prev["Primer contacto"]) out["Primer contacto"] = new Date().toISOString();
  return out;
}
async function logStage(leadId, from, to, s, extra = "") {
  if (from === to) return;
  await createRecord(T.acts, {
    Resumen: `Estado: ${from} → ${to}`, Empresa: [leadId], Tipo: "Cambio de estado", Fecha: new Date().toISOString(),
    Texto: extra, Comercial: s.name, Origen: "Manual",
  });
}

/* ---------- campos de la ficha que vienen de la web ---------- */
function leadFields(l, s, users, isNew) {
  const f = {};
  const set = (k, v) => { if (v !== undefined) f[k] = v; };
  if ("empresa" in l) { const n = str(l.empresa, 200); if (!n) throw new HttpError(400, "Falta el nombre de la empresa o del cliente."); f.Empresa = n; }
  set("Grupo", "grupo" in l ? str(l.grupo, 120) : undefined);
  set("País", "pais" in l ? oneOf(l.pais, COUNTRIES) : undefined);
  set("Provincia", "provincia" in l ? str(l.provincia, 80) : undefined);
  set("Ciudad", "ciudad" in l ? str(l.ciudad, 80) : undefined);
  if ("web" in l) { const w = str(l.web, 300); f.Web = !w ? null : /^https?:\/\//i.test(w) ? w : "https://" + w; }
  set("CIF", "cif" in l ? str(l.cif, 20).toUpperCase() : undefined);
  set("Tipo de cliente", "tipo" in l ? oneOf(l.tipo, TYPES) : undefined);
  set("Línea", "linea" in l ? oneOf(l.linea, LINES) : undefined);
  set("Origen", "origen" in l ? oneOf(l.origen, ORIGINS) : undefined);
  set("Productos", "productos" in l ? (Array.isArray(l.productos) ? l.productos.filter(p => ALL_PRODUCTS.includes(p)) : []) : undefined);
  set("Marcas", "marcas" in l ? (Array.isArray(l.marcas) ? l.marcas.filter(p => BRANDS.includes(p)) : []) : undefined);
  set("Potencial", "potencial" in l ? oneOf(l.potencial, POTENTIAL) : undefined);
  set("Valor estimado", "valor" in l ? Math.max(0, Math.round(Number(l.valor) || 0)) : undefined);
  set("Probabilidad", "prob" in l ? (l.prob === null || l.prob === "" ? null : Math.min(100, Math.max(0, Math.round(Number(l.prob) || 0)))) : undefined);
  if ("accion" in l) { f["Próxima acción"] = oneOf(l.accion, ACTIONS); f["Fecha próxima acción"] = f["Próxima acción"] ? date(l.accionFecha) : null; f["Nota próxima acción"] = f["Próxima acción"] ? str(l.accionNota, 200) : ""; }
  set("Notas", "notas" in l ? str(l.notas, 20000) : undefined);
  // Fase 2 (preparado): ids de Holded / Kommo y enlace de ClickUp
  set("Holded ID", "holdedId" in l ? str(l.holdedId, 60) : undefined);
  set("Kommo ID", "kommoId" in l ? str(l.kommoId, 60) : undefined);
  if ("clickup" in l) f.ClickUp = /^https:\/\/(app\.)?clickup\.com\//.test(String(l.clickup || "")) ? String(l.clickup) : null;
  // comercial asignado: solo el administrador lo elige
  if (s.role === "admin") {
    if ("comercial" in l || isNew) {
      const names = users.filter(u => u.active).map(u => u.name);
      const c = str(l.comercial, 80);
      f.Comercial = names.includes(c) ? c : (isNew ? (users.find(u => u.role === "sales" && u.active)?.name || null) : null);
    }
  } else if (isNew) f.Comercial = s.name;
  return f;
}
async function attachmentsFor(id, list) {
  const keep = new Set();
  if (id) { try { const cur = await getRecord(T.leads, id); (cur.fields?.Adjuntos || []).forEach(a => keep.add(a.id)); } catch {} }
  return (Array.isArray(list) ? list : []).map(a => keep.has(a.id) ? { id: a.id } : (a.url ? { url: a.url, filename: a.name || "archivo" } : null)).filter(Boolean);
}
function contactFields(c, leadId) {
  return { Nombre: str(c.nombre, 120) || "Contacto", Cargo: str(c.cargo, 120), "Área": str(c.area, 80), "Teléfono": str(c.tel, 40), Email: str(c.email, 200), Principal: !!c.principal, Empresa: [leadId] };
}
async function saveContacts(leadId, list) {
  if (!Array.isArray(list)) return;
  const current = (await listAll(T.contacts)).filter(r => link(r.fields?.Empresa) === leadId);
  const mine = new Set(current.map(r => r.id));
  const toCreate = [];
  for (const c of list.slice(0, 30)) {
    if (c.id && !mine.has(c.id)) continue;
    if (c.id && c._delete) { await deleteRecord(T.contacts, c.id); continue; }
    if (c._delete) continue;
    if (!str(c.nombre) && !str(c.tel) && !str(c.email)) continue;
    if (c.id) await updateRecord(T.contacts, c.id, contactFields(c, leadId));
    else toCreate.push(contactFields(c, leadId));
  }
  if (toCreate.length) await createMany(T.contacts, toCreate);
}

/* ---------- duplicados: teléfono, email, CIF y nombre parecido ---------- */
const normName = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)/g, "").replace(/\b(s\.?l\.?u?|s\.?a\.?|grupo|espana|portugal)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
async function findDupes({ tel, email, cif, empresa, excludeId }) {
  const [leads, contacts] = await Promise.all([listAll(T.leads), listAll(T.contacts)]);
  const byId = Object.fromEntries(leads.map(r => [r.id, r]));
  const hits = new Map();
  const add = (id, why) => { if (!id || id === excludeId || !byId[id]) return; const h = hits.get(id) || { id, empresa: byId[id].fields?.Empresa || "", comercial: byId[id].fields?.Comercial || "", estado: byId[id].fields?.Estado || "", why: [] }; if (!h.why.includes(why)) h.why.push(why); hits.set(id, h); };
  const pk = phoneKey(tel), eks = emailKeys(email), ck = cifKey(cif), nk = normName(empresa);
  if (ck.length >= 5) for (const r of leads) if (cifKey(r.fields?.CIF) === ck) add(r.id, "CIF");
  if (nk.length >= 4) for (const r of leads) if (normName(r.fields?.Empresa) === nk) add(r.id, "nombre");
  for (const r of contacts) {
    const lid = link(r.fields?.Empresa);
    if (pk && phoneKey(r.fields?.["Teléfono"]) === pk) add(lid, "teléfono");
    if (eks.length && emailKeys(r.fields?.Email).some(e => eks.includes(e))) add(lid, "email");
  }
  return [...hits.values()];
}

/* ---------- GET ---------- */
async function loadAll(s) {
  const isAdmin = s.role === "admin";
  const [users, leadsR, contactsR, actsR] = await Promise.all([getUsers(), listAll(T.leads), listAll(T.contacts), listAll(T.acts)]);
  const leads = leadsR.map(leadOut).filter(l => isAdmin || l.comercial === s.name);
  const byId = Object.fromEntries(leads.map(l => [l.id, l]));
  for (const c of contactsR.map(contactOut)) if (byId[c.lead]) byId[c.lead].contacts.push(c);
  for (const a of actsR.map(actOut)) if (byId[a.lead]) byId[a.lead].acts.push(a);
  for (const l of leads) {
    l.contacts.sort((a, b) => (b.principal - a.principal) || a.nombre.localeCompare(b.nombre));
    l.acts.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }
  return {
    session: { role: s.role, who: s.who, name: s.name },
    leads,
    users: isAdmin ? users.map(u => ({ rid: u.rid, id: u.id, name: u.name, role: u.role, active: u.active, hasCode: !!u.hash }))
      : users.filter(u => u.active).map(u => ({ id: u.id, name: u.name, role: u.role })),
    lists: LISTS,
    aiEnabled: !!ENV.anthropicKey,
  };
}

export default handler(async (req) => {
  const s = requireAuth(req);
  if (req.method === "GET") return json(await loadAll(s));
  if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
  const isAdmin = s.role === "admin";
  const b = await req.json().catch(() => ({}));
  const admin = () => { if (!isAdmin) throw new HttpError(403, "Solo el administrador puede hacer esto."); };

  switch (b.action) {
    /* ficha completa (alta rápida o edición) */
    case "saveLead": {
      const users = await getUsers();
      const l = b.lead || {};
      let prev = {};
      if (b.id) prev = (await loadLead(b.id, s)).fields || {};
      const fields = leadFields(l, s, users, !b.id);
      if ("adjuntos" in l) fields.Adjuntos = await attachmentsFor(b.id, l.adjuntos);
      const estado = oneOf(l.estado, STAGES, b.id ? (prev.Estado || "Nuevo") : "Nuevo");
      Object.assign(fields, stageFields(prev, estado, l.motivo ?? prev["Motivo pérdida"], l.motivoDetalle ?? prev["Detalle pérdida"]));
      if (!b.id) fields["Fecha alta"] = new Date().toISOString();
      const r = b.id ? await updateRecord(T.leads, b.id, fields) : await createRecord(T.leads, fields);
      await saveContacts(r.id, b.contacts);
      if (b.id) await logStage(r.id, prev.Estado || "Nuevo", estado, s, estado === "Perdido" ? `Motivo: ${fields["Motivo pérdida"]}${fields["Detalle pérdida"] ? " · " + fields["Detalle pérdida"] : ""}` : "");
      return json({ id: r.id, lead: leadOut(r) });
    }
    /* arrastrar en el Kanban */
    case "moveLead": {
      const prev = (await loadLead(b.id, s)).fields || {};
      const estado = oneOf(b.estado, STAGES);
      if (!estado) throw new HttpError(400, "Estado no válido");
      const fields = stageFields(prev, estado, b.motivo, b.motivoDetalle);
      if (!OPEN.includes(estado)) { fields["Próxima acción"] = null; fields["Fecha próxima acción"] = null; fields["Nota próxima acción"] = ""; }
      const r = await updateRecord(T.leads, b.id, fields);
      await logStage(b.id, prev.Estado || "Nuevo", estado, s, estado === "Perdido" ? `Motivo: ${fields["Motivo pérdida"]}${fields["Detalle pérdida"] ? " · " + fields["Detalle pérdida"] : ""}` : "");
      return json({ id: r.id, lead: leadOut(r) });
    }
    /* solo la próxima acción */
    case "setNext": {
      await loadLead(b.id, s);
      const accion = oneOf(b.accion, ACTIONS);
      const r = await updateRecord(T.leads, b.id, { "Próxima acción": accion, "Fecha próxima acción": accion ? date(b.fecha) : null, "Nota próxima acción": accion ? str(b.nota, 200) : "" });
      return json({ id: r.id, lead: leadOut(r) });
    }
    /* registrar llamada, WhatsApp, email, visita o nota (+ próxima acción) */
    case "addActivity": {
      const prev = (await loadLead(b.leadId, s)).fields || {};
      const tipo = oneOf(b.tipo, ACT_TYPES, "Nota");
      const resultado = oneOf(b.resultado, RESULTS);
      const texto = str(b.texto, 20000);
      if (!texto && !resultado) throw new HttpError(400, "Escribe qué ha pasado o elige un resultado.");
      const a = await createRecord(T.acts, {
        Resumen: `${tipo}${resultado ? " · " + resultado : ""}`.slice(0, 120), Empresa: [b.leadId], Tipo: tipo, Fecha: new Date().toISOString(),
        Resultado: resultado, Texto: texto, Contacto: str(b.contacto, 120), Comercial: s.name, Origen: "Manual",
      });
      const upd = {};
      const estadoPrev = prev.Estado || "Nuevo";
      if (tipo !== "Nota") {
        if (!prev["Primer contacto"]) upd["Primer contacto"] = new Date().toISOString();
        if (estadoPrev === "Nuevo") Object.assign(upd, stageFields(prev, "Contactado"));
      }
      if (b.next && oneOf(b.next.accion, ACTIONS)) {
        upd["Próxima acción"] = b.next.accion; upd["Fecha próxima acción"] = date(b.next.fecha); upd["Nota próxima acción"] = str(b.next.nota, 200);
      } else if (b.clearNext) { upd["Próxima acción"] = null; upd["Fecha próxima acción"] = null; upd["Nota próxima acción"] = ""; }
      const r = Object.keys(upd).length ? await updateRecord(T.leads, b.leadId, upd) : await getRecord(T.leads, b.leadId);
      if (upd.Estado && upd.Estado !== estadoPrev) await logStage(b.leadId, estadoPrev, upd.Estado, s, "Automático al registrar el primer contacto");
      return json({ id: r.id, lead: leadOut(r), act: actOut(a) });
    }
    case "deleteActivity": {
      const a = await getRecord(T.acts, b.id);
      const lid = link(a.fields?.Empresa);
      if (!isAdmin) { await loadLead(lid, s); if ((a.fields?.Comercial || "") !== s.name) throw new HttpError(403, "Solo puedes borrar tus propias anotaciones."); }
      await deleteRecord(T.acts, b.id);
      return json({ ok: true });
    }
    case "dupes": {
      return json({ dupes: await findDupes({ tel: b.tel, email: b.email, cif: b.cif, empresa: b.empresa, excludeId: b.excludeId }) });
    }

    /* ----- solo administrador ----- */
    case "deleteLead": {
      admin();
      const [cs, as] = await Promise.all([listAll(T.contacts), listAll(T.acts)]);
      await deleteMany(T.contacts, cs.filter(r => link(r.fields?.Empresa) === b.id).map(r => r.id));
      await deleteMany(T.acts, as.filter(r => link(r.fields?.Empresa) === b.id).map(r => r.id));
      await deleteRecord(T.leads, b.id);
      return json({ ok: true });
    }
    case "reassign": {
      admin();
      const users = await getUsers();
      const name = users.find(u => u.active && u.name === b.comercial)?.name;
      if (!name) throw new HttpError(400, "Comercial no válido");
      const ids = (Array.isArray(b.ids) ? b.ids : []).filter(id => /^rec[A-Za-z0-9]{14}$/.test(id)).slice(0, 500);
      for (let i = 0; i < ids.length; i += 10) {
        await at(encodeURIComponent(T.leads), { method: "PATCH", body: JSON.stringify({ records: ids.slice(i, i + 10).map(id => ({ id, fields: { Comercial: name } })), typecast: true }) });
      }
      return json({ ok: true, count: ids.length });
    }
    case "importLeads": {
      admin();
      const users = await getUsers();
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 60);
      if (!rows.length) throw new HttpError(400, "No hay filas que importar.");
      const now = new Date().toISOString();
      const leadsF = rows.map(row => {
        const f = leadFields({ ...row, accion: row.accion || "", accionFecha: row.accionFecha }, s, users, true);
        f.Estado = "Nuevo"; f["Etapa máxima"] = "Nuevo"; f["Fecha alta"] = now;
        if (!f.Origen) f.Origen = "Prospección comercial";
        return f;
      });
      const created = await createMany(T.leads, leadsF);
      const cs = [];
      created.forEach((r, i) => {
        const row = rows[i];
        if (str(row.contacto) || str(row.tel) || str(row.email)) cs.push(contactFields({ nombre: row.contacto, cargo: row.cargo, tel: row.tel, email: row.email, principal: true }, r.id));
      });
      if (cs.length) await createMany(T.contacts, cs);
      return json({ ok: true, created: created.length });
    }
    case "saveUser": {
      admin();
      const users = await getUsers();
      const u = b.user || {};
      const name = str(u.name, 60);
      if (!name) throw new HttpError(400, "Falta el nombre.");
      const existing = u.rid ? users.find(x => x.rid === u.rid) : null;
      if (u.rid && !existing) throw new HttpError(404, "Usuario no encontrado");
      if (!existing && users.some(x => x.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "Ya hay un usuario con ese nombre.");
      const fields = { Nombre: name };
      if (!existing) {
        let id = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 20) || "comercial";
        while (users.some(x => x.id === id)) id += "1";
        fields.Id = id; fields.Rol = "Comercial"; fields.Activo = true;
        if (!/^\d{6}$/.test(String(u.code || ""))) throw new HttpError(400, "El código tiene que tener exactamente 6 números.");
      } else {
        if (existing.role !== "admin") fields.Activo = u.active !== false;
        if (existing.name !== name && existing.role !== "admin") {
          // el nombre está guardado en los leads: no se cambia para no perder la asignación
          throw new HttpError(400, "El nombre de un comercial no se puede cambiar desde aquí (está en sus leads). Crea uno nuevo y reasigna.");
        }
      }
      if (u.code) {
        if (!/^\d{6}$/.test(String(u.code))) throw new HttpError(400, "El código tiene que tener exactamente 6 números.");
        const h = codeHash(String(u.code));
        if (users.some(x => x.hash === h && x.rid !== u.rid)) throw new HttpError(409, "Ese código ya lo usa otra persona. Cada código debe ser distinto.");
        fields["Huella código"] = h;
      }
      const r = existing ? await updateRecord(T.users, existing.rid, fields) : await createRecord(T.users, fields);
      return json({ ok: true, rid: r.id });
    }
    default: throw new HttpError(400, "Acción desconocida");
  }
});
