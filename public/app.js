/* Comercial Volta · gestión de leads (Volta Baterías)
   Una sola página sin frameworks. Habla con las funciones de Netlify en /.netlify/functions/.
   Reutiliza del calendario Equipo Volta: acceso con código, dictado por voz, PDF propio e IA para ordenar textos. */
(function () {
"use strict";

/* =================== utilidades =================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const eur = n => (Number(n) || 0).toLocaleString("es-ES", { maximumFractionDigits: 0 }) + " €";
const eurK = n => { n = Number(n) || 0; return n >= 10000 ? (n / 1000).toLocaleString("es-ES", { maximumFractionDigits: 0 }) + " k€" : eur(n); };
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayS = () => iso(new Date());
const addDays = (s, n) => { const d = s ? new Date(s + "T12:00:00") : new Date(); d.setDate(d.getDate() + n); return iso(d); };
const parse = s => new Date(String(s).slice(0, 10) + "T12:00:00");
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const short = s => { if (!s) return ""; const d = parse(s); return `${d.getDate()} ${MES[d.getMonth()]}`; };
const nice = s => { if (!s) return ""; const d = parse(s); return `${DIA[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`; };
const dt = s => { if (!s) return ""; const d = new Date(s); return `${d.getDate()} ${MES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}\n${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const initials = n => String(n || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
const stCls = s => "st-" + String(s || "Nuevo").split(" ")[0];
const lnPill = l => l ? `<span class="pill ln-${esc(l)}"><span class="lnd ${esc(l)}"></span>${esc(l)}</span>` : `<span class="pill ln-">Sin línea</span>`;
const stPill = s => `<span class="pill ${stCls(s)}">${esc(s)}</span>`;
const telHref = t => "tel:" + String(t || "").replace(/[^\d+]/g, "");
const waHref = t => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 9) d = "34" + d; return "https://wa.me/" + d; };
const hasPhone = t => String(t || "").replace(/\D/g, "").length >= 9;
const phoneKey = s => { const d = String(s || "").replace(/\D/g, ""); return d.length >= 6 ? d.slice(-9) : ""; };
const emailKeys = s => String(s || "").toLowerCase().split(/[\s,;/]+/).filter(x => /.+@.+\..+/.test(x));
const cifKey = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const nameKey = s => norm(s).replace(/\(.*?\)/g, "").replace(/\b(s\.?l\.?u?|s\.?a\.?|grupo|espana|portugal)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
let toastT; function toast(m) { let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); } t.textContent = m; t.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), 3200); }

/* =================== conexión con Netlify =================== */
const FN = "/.netlify/functions/", TOKEN_KEY = "comercial-volta-token";
const tok = {
  get() { try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); return t && t.exp > Date.now() ? t : null; } catch (e) { return null; } },
  set(t) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...t, exp: Date.now() + 13 * 864e5 })); } catch (e) {} },
  clear() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} },
};
async function call(name, { method = "GET", body, signal } = {}) {
  const t = tok.get();
  const res = await fetch(FN + name, { method, signal, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && name !== "login") { tok.clear(); showLogin(); }
  if (!res.ok) { const e = new Error(data.error || ("Error " + res.status)); e.status = res.status; throw e; }
  return data;
}
const post = body => call("api", { method: "POST", body });

/* =================== estado =================== */
const S = {
  session: null, leads: [], users: [], L: null, ai: false, view: "hoy", loaded: false,
  f: { q: "", linea: "", origen: "", tipo: "", zona: "", comercial: "", estado: "", abiertos: true },
  sort: { k: "accion", dir: 1 }, sel: new Set(), resPeriod: "mes", resLinea: "", resCom: "",
  drawer: null, // {id, tab}
};
const isAdmin = () => S.session && S.session.role === "admin";
const OPEN = () => S.L.OPEN;
const isOpen = l => S.L.OPEN.includes(l.estado);
const lead = id => S.leads.find(l => l.id === id);
const salesNames = () => S.users.filter(u => u.role === "sales" && u.active !== false).map(u => u.name);
const mainContact = l => l.contacts.find(c => c.principal) || l.contacts[0] || null;
const zona = l => l.provincia || l.ciudad || l.pais || "";
function dueState(l) {
  if (!isOpen(l)) return "closed";
  if (!l.accion || !l.accionFecha) return "none";
  const t = todayS();
  return l.accionFecha < t ? "late" : l.accionFecha === t ? "today" : "ok";
}
function dueHtml(l) {
  const st = dueState(l);
  if (st === "closed") return "";
  if (st === "none") return `<span class="noact">⚠ Sin próxima acción</span>`;
  const d = daysBetween(todayS(), l.accionFecha);
  const rel = d === 0 ? "hoy" : d === 1 ? "mañana" : d === -1 ? "ayer" : d < 0 ? `hace ${-d} días` : `en ${d} días`;
  return `<span class="due ${st}">${esc(l.accion)} · ${esc(short(l.accionFecha))} (${rel})</span>`;
}

let loading = null;
async function refresh() {
  if (!tok.get()) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const d = await call("api");
      S.session = d.session; S.leads = d.leads || []; S.users = d.users || []; S.L = d.lists; S.ai = !!d.aiEnabled; S.loaded = true;
      $("#errBanner").classList.add("hidden");
      renderAll();
    } catch (e) {
      if (e.status !== 401) { $("#errBanner").textContent = "No se pudieron cargar los datos: " + e.message; $("#errBanner").classList.remove("hidden"); }
    } finally { loading = null; }
  })();
  return loading;
}
setInterval(() => { if (document.visibilityState === "visible" && tok.get() && !$(".modal-shade") && !dirtyDrawer()) refresh(); }, 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && tok.get() && !$(".modal-shade") && !dirtyDrawer()) refresh(); });
function upsertLead(l) { const i = S.leads.findIndex(x => x.id === l.id); if (i >= 0) { const old = S.leads[i]; S.leads[i] = { ...old, ...l, contacts: l.contacts?.length ? l.contacts : old.contacts, acts: l.acts?.length ? l.acts : old.acts }; } else S.leads.push(l); }

/* =================== acceso =================== */
function showLogin() { $("#app").classList.add("hidden"); $("#login").classList.remove("hidden"); $("#layer").innerHTML = ""; setTimeout(() => $("#codeIn").focus(), 50); }
function showApp() { $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); }
$("#loginForm").onsubmit = async e => {
  e.preventDefault();
  const code = $("#codeIn").value.trim();
  if (!/^\d{6}$/.test(code)) { $("#loginErr").textContent = "Escribe los 6 números de tu código."; return; }
  $("#loginBtn").disabled = true; $("#loginErr").textContent = "";
  try { const r = await call("login", { method: "POST", body: { code } }); tok.set(r); $("#codeIn").value = ""; showApp(); S.view = r.role === "admin" ? "resultados" : "hoy"; await refresh(); }
  catch (er) { $("#loginErr").textContent = er.message; }
  finally { $("#loginBtn").disabled = false; }
};
$("#codeIn").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); if (e.target.value.length === 6) $("#loginForm").requestSubmit(); });
$("#logoutBtn").onclick = () => { tok.clear(); S.leads = []; S.session = null; showLogin(); };

/* =================== cabecera / pestañas =================== */
$("#tabs").onclick = e => { const b = e.target.closest("button[data-v]"); if (!b) return; S.view = b.dataset.v; renderAll(); window.scrollTo(0, 0); };
$("#newBtn").onclick = () => openQuickAdd();
function renderHeader() {
  const s = S.session;
  $("#meAv").textContent = initials(s.name); $("#meName").textContent = s.name;
  $("#meRole").textContent = s.role === "admin" ? "Administrador" : "Comercial";
  $$(".admin-only").forEach(x => x.classList.toggle("hidden", !isAdmin()));
  if (!isAdmin() && S.view === "ajustes") S.view = "hoy";
  $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === S.view));
  ["hoy", "embudo", "lista", "resultados", "ajustes"].forEach(v => { const el = $("#v-" + v); el.classList.toggle("hidden", v !== S.view); if (v !== S.view && el.innerHTML) { el.innerHTML = ""; el.onclick = null; } });
  const mine = S.leads.filter(l => isOpen(l) && (!isAdmin() || !S.f.comercial || l.comercial === S.f.comercial));
  const urgent = mine.filter(l => ["late", "today", "none"].includes(dueState(l))).length;
  $("#cntHoy").textContent = urgent; $("#cntHoy").classList.toggle("hidden", !urgent);
}
function renderAll() {
  if (!S.loaded) return;
  renderHeader();
  ({ hoy: renderHoy, embudo: renderKanban, lista: renderList, resultados: renderResults, ajustes: renderSettings })[S.view]();
  if (S.drawer && lead(S.drawer.id) && !dirtyDrawer()) renderDrawer();
}

/* =================== filtros comunes =================== */
function applyFilters(list, { ignoreEstado = false } = {}) {
  const f = S.f, q = norm(f.q).trim(), words = q.split(/\s+/).filter(Boolean);
  return list.filter(l => {
    if (f.linea && !(l.linea === f.linea || (f.linea !== "Ambas" && l.linea === "Ambas"))) return false;
    if (f.origen && l.origen !== f.origen) return false;
    if (f.tipo && l.tipo !== f.tipo) return false;
    if (f.zona && zona(l) !== f.zona) return false;
    if (isAdmin() && f.comercial && l.comercial !== f.comercial) return false;
    if (!ignoreEstado && f.estado && l.estado !== f.estado) return false;
    if (words.length) {
      const hay = norm([l.empresa, l.grupo, l.ciudad, l.provincia, l.cif, l.tipo, l.notas, ...l.contacts.flatMap(c => [c.nombre, c.cargo, c.tel, c.email])].join(" "));
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });
}
function filtersHtml({ estado = false, abiertos = false } = {}) {
  const f = S.f, L = S.L;
  const opt = (list, v, all) => `<option value="">${all}</option>` + list.map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  const zonas = [...new Set(S.leads.map(zona).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  return `<div class="filters" id="filters">
    <input type="search" data-f="q" placeholder="Buscar empresa, persona, teléfono, email…" value="${esc(f.q)}">
    <div class="seg" data-f="linea">${["", "Litio", "Plomo", "Ambas"].map(x => `<button data-val="${x}" class="${f.linea === x ? "on" : ""}">${x ? `<span class="lnd ${x}"></span>${x}` : "Todas"}</button>`).join("")}</div>
    <select data-f="tipo">${opt(L.TYPES, f.tipo, "Tipo de cliente")}</select>
    <select data-f="origen">${opt(L.ORIGINS, f.origen, "Origen")}</select>
    <select data-f="zona">${opt(zonas, f.zona, "Provincia / ciudad")}</select>
    ${estado ? `<select data-f="estado">${opt(L.STAGES, f.estado, "Estado")}</select>` : ""}
    ${isAdmin() ? `<select data-f="comercial">${opt(salesNames(), f.comercial, "Todos los comerciales")}</select>` : ""}
    ${abiertos ? `<label class="hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-f="abiertos" ${f.abiertos ? "checked" : ""}> Solo abiertos</label>` : ""}
    ${Object.entries(f).some(([k, v]) => k !== "abiertos" && v) ? `<button class="btn ghost sm" data-clear>✕ Quitar filtros</button>` : ""}
  </div>`;
}
function bindFilters(root, rerender) {
  const box = $("#filters", root); if (!box) return;
  box.oninput = e => { const k = e.target.dataset.f; if (!k) return; S.f[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value; if (k === "q") { clearTimeout(bindFilters.t); bindFilters.t = setTimeout(() => { rerender(); const i = $('#filters [data-f="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } else rerender(); };
  box.onclick = e => {
    const b = e.target.closest(".seg button"); if (b) { S.f[b.parentElement.dataset.f] = b.dataset.val; rerender(); }
    if (e.target.closest("[data-clear]")) { Object.assign(S.f, { q: "", linea: "", origen: "", tipo: "", zona: "", comercial: "", estado: "" }); rerender(); }
  };
}

/* =================== HOY =================== */
function urgency(l) { // menor = más urgente
  const st = dueState(l);
  if (st === "late") return 0; if (st === "today") return 1; if (st === "none") return 2; return 3;
}
function leadRow(l, opts = {}) {
  const c = mainContact(l);
  const tel = c && hasPhone(c.tel) ? c.tel : "";
  return `<div class="lrow ${esc(l.linea)}" data-open="${l.id}">
    <div>
      <div class="nm">${esc(l.empresa)} ${lnPill(l.linea)} ${stPill(l.estado)} ${isAdmin() && l.comercial ? `<span class="tag">${esc(l.comercial)}</span>` : ""}</div>
      <div class="meta">${c ? `<span>${esc(c.nombre)}${c.cargo ? " · " + esc(c.cargo) : ""}</span>` : ""}${tel ? `<span class="mono">${esc(tel)}</span>` : ""}${zona(l) ? `<span>${esc(zona(l))}</span>` : ""}${l.tipo ? `<span>${esc(l.tipo)}</span>` : ""}</div>
      ${l.accionNota ? `<div class="meta">📝 ${esc(l.accionNota)}</div>` : ""}
    </div>
    <div class="rt">
      ${opts.alta ? `<span class="due ok">Alta ${esc(short(l.alta))} · ${Math.max(0, daysBetween(String(l.alta).slice(0, 10), todayS()))} días sin contactar</span>` : dueHtml(l)}
      <div class="acts">
        ${l.valor ? `<span class="val">${eurK(l.valor)}</span>` : ""}
        ${tel ? `<a class="btn sm" href="${telHref(tel)}" data-stop title="Llamar">📞</a><a class="btn sm" href="${waHref(tel)}" target="_blank" rel="noopener" data-stop title="WhatsApp">💬</a>` : ""}
        ${c && c.email ? `<a class="btn sm" href="mailto:${esc(emailKeys(c.email)[0] || "")}" data-stop title="Email">✉</a>` : ""}
        <button class="btn sm primary" data-log="${l.id}">Registrar</button>
      </div>
    </div>
  </div>`;
}
function renderHoy() {
  const root = $("#v-hoy");
  const base = S.leads.filter(l => isOpen(l) && (!isAdmin() || !S.f.comercial || l.comercial === S.f.comercial));
  const t = todayS();
  const late = base.filter(l => dueState(l) === "late").sort((a, b) => a.accionFecha.localeCompare(b.accionFecha) || b.valor - a.valor);
  const today = base.filter(l => dueState(l) === "today").sort((a, b) => b.valor - a.valor);
  const nuevos = base.filter(l => l.estado === "Nuevo" && !l.primerContacto && !l.acts.some(a => a.tipo !== "Nota" && a.tipo !== "Cambio de estado"))
    .sort((a, b) => String(a.alta).localeCompare(String(b.alta)) || b.valor - a.valor);
  const nuevosSet = new Set(nuevos.map(l => l.id));
  const sinAcc = base.filter(l => dueState(l) === "none" && !nuevosSet.has(l.id)).sort((a, b) => b.valor - a.valor);
  const prox = base.filter(l => dueState(l) === "ok" && daysBetween(t, l.accionFecha) <= 7).sort((a, b) => a.accionFecha.localeCompare(b.accionFecha));
  const sec = (title, list, cls, opts, emptyTxt) => `<div class="sec-h ${cls || ""}">${title} · ${list.length}</div>${list.length ? list.map(l => leadRow(l, opts)).join("") : `<div class="empty">${emptyTxt}</div>`}`;
  const NUEVOS_MAX = 25;
  root.innerHTML = `
    ${isAdmin() ? `<div class="filters"><select id="hoyCom"><option value="">Todos los comerciales</option>${salesNames().map(n => `<option ${n === S.f.comercial ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>` : ""}
    <div class="kpis">
      <div class="kpi ${late.length ? "bad" : ""}"><small>Vencidas</small><b>${late.length}</b><div class="s">acciones con fecha pasada</div></div>
      <div class="kpi"><small>Para hoy</small><b>${today.length}</b><div class="s">${esc(nice(t))}</div></div>
      <div class="kpi"><small>Nuevos sin contactar</small><b>${nuevos.length}</b><div class="s">${eurK(nuevos.reduce((s, l) => s + l.valor, 0))} en potencial</div></div>
      <div class="kpi ${sinAcc.length ? "bad" : ""}"><small>Sin próxima acción</small><b>${sinAcc.length}</b><div class="s">leads abiertos sin siguiente paso</div></div>
    </div>
    <div class="grid2">
      <div class="card">
        <div class="card-h"><h2>Lo urgente</h2><span class="sub">Ordenado por urgencia</span></div>
        ${sec("Vencidas", late, "bad", {}, "Nada vencido. 👍")}
        ${sec("Para hoy", today, "", {}, "No hay acciones para hoy.")}
        ${sinAcc.length ? sec("Sin próxima acción", sinAcc, "bad", {}, "") : ""}
      </div>
      <div class="card">
        <div class="card-h"><h2>Nuevos sin contactar</h2><span class="sub">Los más antiguos primero</span></div>
        ${nuevos.length ? nuevos.slice(0, NUEVOS_MAX).map(l => leadRow(l, { alta: true })).join("") + (nuevos.length > NUEVOS_MAX ? `<div class="empty">Y ${nuevos.length - NUEVOS_MAX} más. <a href="#" data-goto-new>Verlos en la lista</a></div>` : "") : `<div class="empty">Todos los leads nuevos están contactados.</div>`}
        <div class="sec-h">Próximos 7 días · ${prox.length}</div>
        ${prox.length ? prox.map(l => leadRow(l)).join("") : `<div class="empty">Nada programado esta semana.</div>`}
      </div>
    </div>`;
  const hc = $("#hoyCom", root); if (hc) hc.onchange = e => { S.f.comercial = e.target.value; renderAll(); };
  const g = $("[data-goto-new]", root); if (g) g.onclick = e => { e.preventDefault(); S.f.estado = "Nuevo"; S.view = "lista"; renderAll(); };
  bindRows(root);
}
function bindRows(root) {
  root.onclick = e => {
    if (e.target.closest("[data-stop]")) return;
    const lg = e.target.closest("[data-log]"); if (lg) { openDrawer(lg.dataset.log, "seg", true); return; }
    const o = e.target.closest("[data-open]"); if (o) openDrawer(o.dataset.open);
  };
}

/* =================== EMBUDO (Kanban) =================== */
function renderKanban() {
  const root = $("#v-embudo");
  const list = applyFilters(S.leads, { ignoreEstado: true });
  const MAXC = 60;
  root.innerHTML = filtersHtml() + `<div class="kanban">${S.L.STAGES.map(st => {
    const items = list.filter(l => l.estado === st).sort((a, b) => urgency(a) - urgency(b) || String(a.accionFecha || "9").localeCompare(String(b.accionFecha || "9")) || b.valor - a.valor);
    const sum = items.reduce((s, l) => s + l.valor, 0);
    return `<div class="col" data-st="${esc(st)}">
      <div class="col-h"><b>${esc(st)} <span class="pill ${stCls(st)}">${items.length}</span></b><div class="sum">${eur(sum)}</div></div>
      <div class="col-b">${items.slice(0, MAXC).map(kCard).join("")}${items.length > MAXC ? `<div class="more">+ ${items.length - MAXC} más (usa los filtros)</div>` : ""}${!items.length ? `<div class="more">Arrastra aquí</div>` : ""}</div>
    </div>`;
  }).join("")}</div>
  <p class="hint">Arrastra una tarjeta a otra columna para cambiar su estado. Al soltar en «Perdido» se pide el motivo.</p>`;
  bindFilters(root, renderKanban);
  let dragId = null;
  $$(".kc", root).forEach(c => {
    c.addEventListener("dragstart", e => { dragId = c.dataset.open; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); });
    c.addEventListener("dragend", () => c.classList.remove("dragging"));
  });
  $$(".col", root).forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", e => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); });
    col.addEventListener("drop", e => { e.preventDefault(); col.classList.remove("over"); const id = e.dataTransfer.getData("text/plain") || dragId; if (id) moveTo(id, col.dataset.st); });
  });
  bindRows(root);
}
function kCard(l) {
  const st = dueState(l), c = mainContact(l);
  return `<div class="kc ${esc(l.linea)} ${st === "none" ? "missing" : ""}" draggable="true" data-open="${l.id}">
    <div class="t">${esc(l.empresa)}</div>
    <div class="r">${lnPill(l.linea)}${l.valor ? `<span class="val">${eurK(l.valor)}</span>` : ""}</div>
    ${l.tipo || zona(l) ? `<div class="hint" style="margin-top:4px">${esc([l.tipo, zona(l)].filter(Boolean).join(" · "))}</div>` : ""}
    ${c && c.nombre ? `<div class="hint">${esc(c.nombre)}</div>` : ""}
    ${st !== "closed" ? `<div style="margin-top:5px">${dueHtml(l)}</div>` : l.estado === "Perdido" && l.motivo ? `<div class="hint" style="margin-top:4px">Motivo: ${esc(l.motivo)}</div>` : ""}
    ${isAdmin() && l.comercial ? `<div class="r"><span class="tag">${esc(l.comercial)}</span></div>` : ""}
  </div>`;
}
async function moveTo(id, estado, opts = {}) {
  const l = lead(id); if (!l || l.estado === estado) return;
  let motivo = null, detalle = "";
  if (estado === "Perdido") { const r = await askLoss(l); if (!r) return; motivo = r.motivo; detalle = r.detalle; }
  const prev = l.estado; l.estado = estado; renderAll();
  try {
    const r = await post({ action: "moveLead", id, estado, motivo, motivoDetalle: detalle });
    upsertLead(r.lead); toast(`${l.empresa}: ${prev} → ${estado}`);
    if (S.L.OPEN.includes(estado) && !r.lead.accion && !opts.silent) toast(`${l.empresa}: ${estado}. ⚠ Ponle una próxima acción.`);
  } catch (e) { l.estado = prev; toast(e.message); }
  renderAll(); refresh();
}
function askLoss(l) {
  return new Promise(resolve => {
    const m = modal(`<div class="m-h"><h2>Marcar como perdido</h2><button class="btn ghost" data-x>✕</button></div>
      <div class="m-b"><p style="margin:0"><b>${esc(l.empresa)}</b>: ¿por qué se ha perdido?</p>
        <div class="types" id="lossT">${S.L.LOSS.map(x => `<button type="button" data-v="${esc(x)}">${esc(x)}</button>`).join("")}</div>
        <label class="f">Detalle (opcional)<input id="lossD" placeholder="Ej.: se queda con su proveedor actual"></label></div>
      <div class="m-f"><span class="hint" id="lossErr" style="margin-right:auto"></span><button class="btn" data-x>Cancelar</button><button class="btn primary" id="lossOk">Marcar perdido</button></div>`, () => resolve(null));
    let v = null;
    $("#lossT", m.el).onclick = e => { const b = e.target.closest("button"); if (!b) return; v = b.dataset.v; $$("#lossT button", m.el).forEach(x => x.classList.toggle("on", x === b)); };
    $("#lossOk", m.el).onclick = () => { if (!v) { $("#lossErr", m.el).textContent = "Elige un motivo."; return; } m.close(true); resolve({ motivo: v, detalle: $("#lossD", m.el).value.trim() }); };
  });
}

/* =================== LISTA =================== */
function listRows() {
  let list = applyFilters(S.leads);
  if (S.f.abiertos && !S.f.estado) list = list.filter(isOpen);
  const k = S.sort.k, d = S.sort.dir;
  const val = l => k === "accion" ? (isOpen(l) ? (l.accionFecha || "0000") : "9999") : k === "valor" ? l.valor : k === "estado" ? S.L.STAGES.indexOf(l.estado) : k === "alta" ? String(l.alta) : norm(l[k] || "");
  return list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * d || a.empresa.localeCompare(b.empresa, "es"); });
}
function renderList() {
  const root = $("#v-lista");
  const rows = listRows();
  const th = (k, t, cls = "") => `<th data-sort="${k}" class="${cls}">${t}${S.sort.k === k ? (S.sort.dir > 0 ? " ↑" : " ↓") : ""}</th>`;
  const total = rows.reduce((s, l) => s + l.valor, 0);
  root.innerHTML = filtersHtml({ estado: true, abiertos: true }) + `
  <div class="card">
    <div class="card-h"><h2>${rows.length} lead${rows.length === 1 ? "" : "s"} <span class="sub mono">${eur(total)}</span></h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${isAdmin() ? `<span id="bulk" class="${S.sel.size ? "" : "hidden"}" style="display:flex;gap:6px;align-items:center"><span class="hint">${S.sel.size} marcados →</span><select id="bulkCom" class="inp" style="padding:5px 8px">${salesNames().map(n => `<option>${esc(n)}</option>`).join("")}</select><button class="btn sm" id="bulkGo">Reasignar</button></span>` : ""}
        <button class="btn" id="csvBtn" title="Descarga los leads de esta lista (con los filtros aplicados) para abrir en Excel">⤓ Excel (CSV)</button>
        <button class="btn" id="pdfBtn" title="Cartera del comercial en PDF: leads abiertos con su próxima acción">⤓ PDF cartera</button>
      </div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>
      ${isAdmin() ? `<th><input type="checkbox" id="selAll"></th>` : ""}
      ${th("empresa", "Empresa")}${th("linea", "Línea")}${th("estado", "Estado")}${th("tipo", "Tipo")}${th("ciudad", "Zona")}${th("origen", "Origen")}${th("valor", "Valor", "num")}${th("accion", "Próxima acción")}${isAdmin() ? th("comercial", "Comercial") : ""}
    </tr></thead><tbody>
    ${rows.slice(0, 400).map(l => { const c = mainContact(l); return `<tr class="click" data-open="${l.id}">
      ${isAdmin() ? `<td data-stop><input type="checkbox" data-sel="${l.id}" ${S.sel.has(l.id) ? "checked" : ""}></td>` : ""}
      <td><b>${esc(l.empresa)}</b>${c ? `<div class="hint">${esc(c.nombre)}${c.tel ? " · " + esc(c.tel) : ""}</div>` : ""}</td>
      <td>${lnPill(l.linea)}</td><td>${stPill(l.estado)}</td><td>${esc(l.tipo)}</td><td>${esc(zona(l))}</td><td>${esc(l.origen)}</td>
      <td class="num">${l.valor ? eur(l.valor) : ""}</td><td>${dueHtml(l) || (l.cierre ? `<span class="hint">Cerrado ${esc(short(l.cierre))}</span>` : "")}</td>
      ${isAdmin() ? `<td>${esc(l.comercial)}</td>` : ""}</tr>`; }).join("")}
    </tbody></table>${rows.length > 400 ? `<div class="empty">Se muestran 400 de ${rows.length}. Afina con los filtros (la exportación incluye todos).</div>` : ""}${!rows.length ? `<div class="empty">No hay leads con estos filtros.</div>` : ""}</div>
  </div>`;
  bindFilters(root, renderList);
  $$("th[data-sort]", root).forEach(h => h.onclick = () => { const k = h.dataset.sort; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (k === "valor" ? -1 : 1) }; renderList(); });
  root.onclick = e => {
    const cb = e.target.closest("[data-sel]"); if (cb) { cb.checked ? S.sel.add(cb.dataset.sel) : S.sel.delete(cb.dataset.sel); renderList(); return; }
    if (e.target.closest("[data-stop]")) return;
    const o = e.target.closest("[data-open]"); if (o) openDrawer(o.dataset.open);
  };
  const sa = $("#selAll", root); if (sa) sa.onchange = () => { rows.forEach(l => sa.checked ? S.sel.add(l.id) : S.sel.delete(l.id)); renderList(); };
  const bg = $("#bulkGo", root); if (bg) bg.onclick = async () => {
    const com = $("#bulkCom", root).value, ids = [...S.sel];
    if (!confirmBox(`¿Asignar ${ids.length} lead(s) a ${com}?`)) return;
    bg.disabled = true;
    try { await post({ action: "reassign", ids, comercial: com }); S.sel.clear(); toast(`${ids.length} lead(s) asignados a ${com}`); await refresh(); } catch (er) { toast(er.message); bg.disabled = false; }
  };
  $("#csvBtn", root).onclick = () => exportCsv(rows);
  $("#pdfBtn", root).onclick = () => exportPdf();
}
function confirmBox(msg) { return window.confirm(msg); }

/* =================== exportar =================== */
function download(filename, blob) { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 1500); }
function exportCsv(rows) {
  const cols = [["Empresa", l => l.empresa], ["Grupo", l => l.grupo], ["Línea", l => l.linea], ["Estado", l => l.estado], ["Tipo de cliente", l => l.tipo], ["Origen", l => l.origen],
    ["País", l => l.pais], ["Provincia", l => l.provincia], ["Ciudad", l => l.ciudad], ["CIF", l => l.cif], ["Web", l => l.web],
    ["Contacto", l => mainContact(l)?.nombre || ""], ["Cargo", l => mainContact(l)?.cargo || ""], ["Teléfono", l => mainContact(l)?.tel || ""], ["Email", l => mainContact(l)?.email || ""],
    ["Productos", l => l.productos.join(", ")], ["Marcas", l => l.marcas.join(", ")], ["Potencial", l => l.potencial], ["Valor estimado (€)", l => l.valor || ""], ["Probabilidad (%)", l => l.prob ?? ""],
    ["Próxima acción", l => l.accion], ["Fecha próxima acción", l => l.accionFecha || ""], ["Nota próxima acción", l => l.accionNota],
    ["Comercial", l => l.comercial], ["Fecha alta", l => String(l.alta || "").slice(0, 10)], ["Primer contacto", l => String(l.primerContacto || "").slice(0, 10)], ["Fecha cierre", l => l.cierre || ""],
    ["Motivo pérdida", l => l.motivo], ["Nº actividades", l => l.acts.filter(a => a.tipo !== "Cambio de estado").length], ["Última actividad", l => String(l.acts.find(a => a.tipo !== "Cambio de estado")?.fecha || "").slice(0, 10)], ["Notas", l => l.notas]];
  const q = v => { const s = String(v ?? ""); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [cols.map(c => q(c[0])).join(";"), ...rows.map(l => cols.map(c => q(c[1](l))).join(";"))].join("\r\n");
  download(`Leads Comercial Volta ${todayS()}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
  toast(`${rows.length} leads exportados`);
}

/* ---------- PDF propio (el mismo generador que el calendario Equipo Volta) ---------- */
const HEX = { ink: "#1d1f22", ink2: "#4a4f57", mute: "#7c838c", line: "#dcdcd9", soft: "#f5f4f2", bad: "#b23a32", accent: "#b5532f", ok: "#3f8f5a", warn: "#a8801f", Litio: "#3f8f5a", Plomo: "#4f6d84", Ambas: "#8aa093" };
class MiniPDF {
  constructor() { this.W = 595.28; this.H = 841.89; this.pages = []; this.ctx = document.createElement("canvas").getContext("2d"); this.addPage(); }
  addPage() { this.cur = []; this.pages.push(this.cur); }
  rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => (v / 255).toFixed(3)).join(" "); }
  clean(s) { return String(s ?? "").replace(/[→⇒]/g, "->").replace(/[  ]/g, " ").replace(/[⚠✕📞💬✉📝👍]/gu, ""); }
  enc(s) {
    const SP = { "€": 128, "‚": 130, "„": 132, "…": 133, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "–": 150, "—": 151 };
    let o = ""; for (const ch of this.clean(s)) { let c = SP[ch] !== undefined ? SP[ch] : ch.codePointAt(0); if (c > 255 || (c >= 128 && c < 160 && SP[ch] === undefined)) c = 63; const C = String.fromCharCode(c); o += (C === "\\" || C === "(" || C === ")") ? "\\" + C : C; }
    return o;
  }
  width(s, size, bold) { this.ctx.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`; return this.ctx.measureText(this.clean(s)).width; }
  wrap(s, size, bold, maxW) {
    const out = [];
    for (const para of this.clean(s).split(/\n/)) {
      if (!para.trim()) { out.push(""); continue; }
      let line = "";
      for (const word of para.split(/\s+/)) {
        const tryL = line ? line + " " + word : word;
        if (this.width(tryL, size, bold) <= maxW) { line = tryL; continue; }
        if (line) out.push(line);
        if (this.width(word, size, bold) <= maxW) { line = word; continue; }
        let chunk = ""; for (const ch of word) { if (this.width(chunk + ch, size, bold) > maxW) { out.push(chunk); chunk = ch; } else chunk += ch; } line = chunk;
      }
      if (line) out.push(line);
    }
    return out;
  }
  text(x, y, s, o = {}) { const size = o.size || 10; this.cur.push(`BT /${o.bold ? "F2" : "F1"} ${size} Tf ${this.rgb(o.color || HEX.ink)} rg ${x.toFixed(2)} ${(this.H - y).toFixed(2)} Td (${this.enc(s)}) Tj ET`); }
  textR(xr, y, s, o = {}) { this.text(xr - this.width(s, o.size || 10, o.bold), y, s, o); }
  rect(x, y, w, h, color) { this.cur.push(`${this.rgb(color)} rg ${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  line(x1, y1, x2, y2, color, lw = .6) { this.cur.push(`${this.rgb(color)} RG ${lw} w ${x1.toFixed(2)} ${(this.H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.H - y2).toFixed(2)} l S`); }
  output() {
    const objs = []; const n = this.pages.length;
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[2] = `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`;
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    this.pages.forEach((p, i) => {
      const st = p.join("\n");
      objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
      objs[6 + i * 2] = `<< /Length ${st.length} >>\nstream\n${st}\nendstream`;
    });
    let out = "%PDF-1.4\n%âãÏÓ\n"; const off = [];
    for (let k = 1; k < objs.length; k++) { off[k] = out.length; out += `${k} 0 obj\n${objs[k]}\nendobj\n`; }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + off.slice(1).map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const b = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 255; return b;
  }
}
function exportPdf() {
  // Cartera: leads abiertos (con los filtros actuales, salvo el de estado), agrupados por comercial y estado.
  const rows = applyFilters(S.leads, { ignoreEstado: true }).filter(isOpen);
  if (!rows.length) { toast("No hay leads abiertos con estos filtros."); return; }
  const groups = {}; rows.forEach(l => (groups[l.comercial || "Sin asignar"] ||= []).push(l));
  const P = new MiniPDF(), W = P.W, H = P.H, M = 42, CW = W - 2 * M;
  let y = 0, who = "";
  const header = (name, cont) => {
    P.rect(0, 0, W, 7, HEX.accent);
    P.text(M, 44, "Comercial Volta", { size: 20, bold: true }); P.textR(W - M, 44, "Volta Baterías · Cartera de leads", { size: 9, color: HEX.mute });
    P.text(M, 71, "Cartera de " + name + (cont ? " (continuación)" : ""), { size: 15, bold: true });
    P.textR(W - M, 71, nice(todayS()), { size: 10, color: HEX.ink2 });
    P.line(M, 82, W - M, 82, HEX.line, .8); y = 100;
  };
  const need = h => { if (y + h > H - 56) { P.addPage(); header(who, true); } };
  Object.keys(groups).sort().forEach((name, gi) => {
    if (gi > 0) P.addPage();
    who = name; header(name, false);
    const ls = groups[name];
    const late = ls.filter(l => dueState(l) === "late").length, none = ls.filter(l => dueState(l) === "none").length;
    const byLine = ["Litio", "Plomo", "Ambas"].map(x => `${x}: ${eur(ls.filter(l => l.linea === x).reduce((s, l) => s + l.valor, 0))}`).join("  ·  ");
    P.rect(M, y, CW, 50, HEX.soft);
    P.text(M + 12, y + 19, `${ls.length} leads abiertos · ${eur(ls.reduce((s, l) => s + l.valor, 0))} en cartera · ${late} vencidos · ${none} sin próxima acción`, { size: 10.5, bold: true, color: late || none ? HEX.bad : HEX.ink });
    P.text(M + 12, y + 36, byLine, { size: 9.5, color: HEX.ink2 });
    y += 66;
    for (const st of S.L.OPEN) {
      const items = ls.filter(l => l.estado === st).sort((a, b) => urgency(a) - urgency(b) || String(a.accionFecha || "9").localeCompare(String(b.accionFecha || "9")));
      if (!items.length) continue;
      need(40);
      P.text(M, y, `${st} (${items.length})`, { size: 12, bold: true, color: HEX.accent }); y += 16;
      for (const l of items) {
        const c = mainContact(l), ds = dueState(l);
        const l1 = [l.linea, l.tipo, zona(l), l.valor ? eur(l.valor) : ""].filter(Boolean).join("  ·  ");
        const l2 = c ? [c.nombre, c.tel, c.email].filter(Boolean).join("  ·  ") : "";
        const l3 = ds === "none" ? "SIN PRÓXIMA ACCIÓN" : `Próxima acción: ${l.accion} · ${nice(l.accionFecha)}${l.accionNota ? " · " + l.accionNota : ""}`;
        const titleL = P.wrap(l.empresa, 11, true, CW - 14), l2L = l2 ? P.wrap(l2, 9, false, CW - 14) : [], l3L = P.wrap(l3, 9, true, CW - 14);
        need(titleL.length * 14 + 12 + l2L.length * 11 + l3L.length * 11 + 12);
        const y0 = y;
        titleL.forEach(t => { P.text(M + 10, y, t, { size: 11, bold: true }); y += 14; });
        P.text(M + 10, y, l1, { size: 9, color: HEX.ink2 }); y += 12;
        l2L.forEach(t => { P.text(M + 10, y, t, { size: 9, color: HEX.ink2 }); y += 11; });
        l3L.forEach(t => { P.text(M + 10, y, t, { size: 9, bold: true, color: ds === "late" || ds === "none" ? HEX.bad : ds === "today" ? HEX.warn : HEX.ink2 }); y += 11; });
        P.rect(M, y0 - 10, 3, y - y0 + 4, HEX[l.linea] || HEX.line);
        y += 4; P.line(M, y, W - M, y, HEX.line, .4); y += 14;
      }
      y += 4;
    }
  });
  const gen = new Date().toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  P.pages.forEach((p, i) => { P.cur = p; P.line(M, H - 40, W - M, H - 40, HEX.line, .5); P.text(M, H - 26, `Generado el ${gen}`, { size: 8, color: HEX.mute }); P.textR(W - M, H - 26, `Página ${i + 1} de ${P.pages.length}`, { size: 8, color: HEX.mute }); });
  const names = Object.keys(groups);
  download(`Cartera ${names.length === 1 ? names[0] : "comerciales"} ${todayS()}.pdf`, new Blob([P.output()], { type: "application/pdf" }));
  toast("PDF descargado");
}

/* =================== RESULTADOS =================== */
function periodRange() {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  if (S.resPeriod === "mes") return [iso(new Date(y, m, 1)), todayS(), "este mes"];
  if (S.resPeriod === "mesant") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0)), "el mes pasado"];
  if (S.resPeriod === "90") return [addDays(todayS(), -90), todayS(), "los últimos 90 días"];
  if (S.resPeriod === "año") return [iso(new Date(y, 0, 1)), todayS(), "este año"];
  return ["0000-00-00", "9999-99-99", "todo el histórico"];
}
function renderResults() {
  const root = $("#v-resultados");
  const [from, to, label] = periodRange();
  let base = S.leads;
  if (isAdmin() && S.resCom) base = base.filter(l => l.comercial === S.resCom);
  if (S.resLinea) base = base.filter(l => l.linea === S.resLinea);
  const inP = d => d && String(d).slice(0, 10) >= from && String(d).slice(0, 10) <= to;
  const open = base.filter(isOpen);
  const won = base.filter(l => l.estado === "Ganado" && inP(l.cierre)), lost = base.filter(l => l.estado === "Perdido" && inP(l.cierre));
  const pipe = open.reduce((s, l) => s + l.valor, 0), weighted = open.reduce((s, l) => s + l.valor * ((l.prob ?? defProb(l.estado)) / 100), 0);
  // tiempo hasta el primer contacto (leads dados de alta en el periodo y ya contactados)
  const fc = base.filter(l => inP(l.alta) && l.primerContacto).map(l => Math.max(0, (new Date(l.primerContacto) - new Date(l.alta)) / 864e5));
  const avgFc = fc.length ? fc.reduce((a, b) => a + b, 0) / fc.length : null;
  // embudo: cuántos han llegado al menos a cada etapa (todos los leads del filtro)
  const reach = st => { const i = S.L.STAGES.indexOf(st); return base.filter(l => S.L.STAGES.indexOf(maxStage(l)) >= i).length; };
  const funnel = S.L.STAGES.filter(s => s !== "Perdido" && s !== "No interesado").map(s => ({ s, n: reach(s) }));
  const top = funnel[0].n || 1;
  const bars = (items, fmt, color) => { const mx = Math.max(1, ...items.map(i => i.v)); return items.map(i => `<div class="bar-r"><span>${i.label}</span><div class="bar-t"><div class="bar-f" style="width:${i.v / mx * 100}%;background:${i.color || color || "var(--accent)"}"></div></div><span class="n">${fmt(i)}</span></div>`).join(""); };
  const lossR = S.L.LOSS.map(m => ({ label: esc(m), v: lost.filter(l => l.motivo === m).length })).filter(x => x.v);
  const noInt = base.filter(l => l.estado === "No interesado" && inP(l.cierre));
  const origins = S.L.ORIGINS.map(o => { const ls = base.filter(l => l.origen === o && inP(l.alta)); return { label: esc(o), v: ls.length, w: ls.filter(l => l.estado === "Ganado").length }; }).filter(x => x.v).sort((a, b) => b.v - a.v);
  const lineColor = { Litio: "var(--litio)", Plomo: "var(--plomo)", Ambas: "#8aa093" };
  root.innerHTML = `
  <div class="filters">
    <div class="seg" id="resP">${[["mes", "Este mes"], ["mesant", "Mes pasado"], ["90", "90 días"], ["año", "Este año"], ["todo", "Todo"]].map(([k, t]) => `<button data-val="${k}" class="${S.resPeriod === k ? "on" : ""}">${t}</button>`).join("")}</div>
    <div class="seg" id="resL">${["", "Litio", "Plomo", "Ambas"].map(x => `<button data-val="${x}" class="${S.resLinea === x ? "on" : ""}">${x ? `<span class="lnd ${x}"></span>${x}` : "Todas"}</button>`).join("")}</div>
    ${isAdmin() ? `<select id="resC"><option value="">Todos los comerciales</option>${salesNames().map(n => `<option ${n === S.resCom ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
  </div>
  <div class="kpis">
    <div class="kpi"><small>Cartera abierta</small><b>${eurK(pipe)}</b><div class="s">${open.length} leads · ponderada ${eurK(weighted)}</div></div>
    <div class="kpi ok"><small>Ganados (${esc(label)})</small><b>${won.length}</b><div class="s">${eur(won.reduce((s, l) => s + l.valor, 0))}</div></div>
    <div class="kpi ${lost.length ? "bad" : ""}"><small>Perdidos (${esc(label)})</small><b>${lost.length}</b><div class="s">${eur(lost.reduce((s, l) => s + l.valor, 0))}${noInt.length ? ` · ${noInt.length} no interesados` : ""}</div></div>
    <div class="kpi"><small>Tasa de cierre</small><b>${won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) + " %" : "—"}</b><div class="s">ganados / cerrados ${esc(label)}</div></div>
    <div class="kpi"><small>1er contacto</small><b>${avgFc == null ? "—" : avgFc < 1 ? Math.round(avgFc * 24) + " h" : avgFc.toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " d"}</b><div class="s">tiempo medio desde el alta (${fc.length} leads)</div></div>
  </div>
  <div class="grid2">
    <div class="card"><div class="card-h"><h2>Embudo</h2><span class="sub">Leads que han llegado a cada etapa · conversión desde la anterior</span></div>
      <div class="bars">${funnel.map((f, i) => `<div class="bar-r"><span>${stPill(f.s)}</span><div class="bar-t"><div class="bar-f" style="width:${f.n / top * 100}%"></div></div><span class="n">${f.n}${i ? ` <span class="conv">${funnel[i - 1].n ? Math.round(f.n / funnel[i - 1].n * 100) : 0} %</span>` : ""}</span></div>`).join("")}
      <div class="hint">Total en el filtro: ${base.length} leads · ${base.filter(l => l.estado === "Perdido").length} perdidos y ${base.filter(l => l.estado === "No interesado").length} no interesados en total.</div></div></div>
    <div class="card"><div class="card-h"><h2>Cartera abierta por línea</h2><span class="sub">Valor estimado de los leads abiertos</span></div>
      <div class="bars">${bars(["Litio", "Plomo", "Ambas"].map(x => { const ls = open.filter(l => l.linea === x); return { label: lnPill(x), v: ls.reduce((s, l) => s + l.valor, 0), n: ls.length, color: lineColor[x] }; }), i => `${eurK(i.v)} · ${i.n}`)}</div>
      <div class="card-h" style="border-top:1px solid var(--line)"><h2>Cartera por etapa</h2></div>
      <div class="bars">${bars(S.L.OPEN.map(st => { const ls = open.filter(l => l.estado === st); return { label: stPill(st), v: ls.reduce((s, l) => s + l.valor, 0), n: ls.length }; }), i => `${eurK(i.v)} · ${i.n}`)}</div></div>
    <div class="card"><div class="card-h"><h2>Motivos de pérdida</h2><span class="sub">${esc(label)}</span></div>
      <div class="bars">${lossR.length ? bars(lossR, i => String(i.v), "var(--bad)") : `<div class="empty">Ningún lead perdido ${esc(label)}.</div>`}</div></div>
    <div class="card"><div class="card-h"><h2>Leads por origen</h2><span class="sub">Altas ${esc(label)} · ganados</span></div>
      <div class="bars">${origins.length ? bars(origins, i => `${i.v} · ${i.w} ✓`) : `<div class="empty">No hay altas ${esc(label)}.</div>`}</div></div>
  </div>`;
  $("#resP", root).onclick = e => { const b = e.target.closest("button"); if (b) { S.resPeriod = b.dataset.val; renderResults(); } };
  $("#resL", root).onclick = e => { const b = e.target.closest("button"); if (b) { S.resLinea = b.dataset.val; renderResults(); } };
  const rc = $("#resC", root); if (rc) rc.onchange = () => { S.resCom = rc.value; renderResults(); };
  void noInt;
}
const defProb = st => ({ Nuevo: 5, Contactado: 10, Interesado: 25, "Presupuesto enviado": 45, "Negociación": 70, Ganado: 100, "No interesado": 0, Perdido: 0 }[st] ?? 0);
const maxStage = l => { if (l.etapaMax) return l.etapaMax; return l.estado === "Perdido" || l.estado === "No interesado" ? "Nuevo" : l.estado; };

/* =================== FICHA DEL LEAD (panel lateral) =================== */
let drawerDirty = false;
const dirtyDrawer = () => drawerDirty;
function openDrawer(id, tab = "seg", focusLog = false) { S.drawer = { id, tab, focusLog }; drawerDirty = false; renderDrawer(); }
function closeDrawer() {
  if (drawerDirty && !confirmBox("Hay cambios sin guardar. ¿Cerrar igualmente?")) return;
  stopDict(); S.drawer = null; drawerDirty = false; $("#layer").innerHTML = "";
}
function renderDrawer() {
  const l = lead(S.drawer.id); if (!l) { closeDrawer(); return; }
  const tab = S.drawer.tab;
  $("#layer").innerHTML = `<div class="shade" id="shade"><aside class="drawer" role="dialog" aria-label="${esc(l.empresa)}">
    <div class="dr-h">
      <button class="btn ghost x" id="drX" title="Cerrar">✕</button>
      <h2>${esc(l.empresa)}</h2>
      <div class="pills">${lnPill(l.linea)} ${stPill(l.estado)} ${l.tipo ? `<span class="tag">${esc(l.tipo)}</span>` : ""} ${zona(l) ? `<span class="tag">${esc(zona(l))}</span>` : ""} ${l.valor ? `<span class="val">${eur(l.valor)}</span>` : ""} ${l.comercial ? `<span class="tag">👤 ${esc(l.comercial)}</span>` : ""}</div>
      <div class="dr-tabs"><button data-t="seg" class="${tab === "seg" ? "on" : ""}">Seguimiento</button><button data-t="ficha" class="${tab === "ficha" ? "on" : ""}">Ficha y contactos</button></div>
    </div>
    <div class="dr-b" id="drB">${tab === "seg" ? segHtml(l) : fichaHtml(l)}</div>
  </aside></div>`;
  $("#shade").onclick = e => { if (e.target.id === "shade") closeDrawer(); };
  $("#drX").onclick = closeDrawer;
  $$(".dr-tabs button").forEach(b => b.onclick = () => { if (drawerDirty && !confirmBox("Hay cambios sin guardar. ¿Cambiar de pestaña igualmente?")) return; drawerDirty = false; S.drawer.tab = b.dataset.t; renderDrawer(); });
  if (tab === "seg") bindSeg(l); else bindFicha(l);
}
document.addEventListener("keydown", e => { if (e.key === "Escape") { if ($(".modal-shade")) return; if (S.drawer) closeDrawer(); } });

/* ---------- pestaña Seguimiento ---------- */
function nextFields(prefix, l) {
  const v = l || {};
  return `<div class="fgrid">
    <label class="f">Próxima acción<select id="${prefix}Acc"><option value="">— Ninguna —</option>${S.L.ACTIONS.map(a => `<option ${a === v.accion ? "selected" : ""}>${a}</option>`).join("")}</select></label>
    <label class="f">Fecha<input type="date" id="${prefix}Fec" value="${esc(v.accionFecha || "")}"></label>
    <label class="f wide">Nota (opcional)<input id="${prefix}Not" value="${esc(v.accionNota || "")}" placeholder="Ej.: preguntar por el pedido de AGM"></label>
  </div>
  <div class="chips" data-dates="${prefix}">${[["Hoy", 0], ["Mañana", 1], ["+3 días", 3], ["+1 semana", 7], ["+2 semanas", 14], ["+1 mes", 30]].map(([t, n]) => `<button type="button" data-n="${n}">${t}</button>`).join("")}</div>`;
}
function bindDates(root, prefix) {
  const box = $(`[data-dates="${prefix}"]`, root); if (!box) return;
  box.onclick = e => { const b = e.target.closest("button"); if (!b) return; let d = addDays(todayS(), Number(b.dataset.n)); const wd = parse(d).getDay(); if (wd === 6) d = addDays(d, 2); if (wd === 0) d = addDays(d, 1); $(`#${prefix}Fec`, root).value = d; if (!$(`#${prefix}Acc`, root).value) $(`#${prefix}Acc`, root).value = "Llamar"; drawerDirty = true; };
}
function segHtml(l) {
  const st = dueState(l), c = mainContact(l), open = isOpen(l);
  const contacts = l.contacts.filter(x => x.tel || x.email);
  return `
  ${contacts.length ? `<div class="box"><h3>Contactar</h3>${contacts.map(x => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px"><b style="min-width:0">${esc(x.nombre)}</b>${x.cargo ? `<span class="hint">${esc(x.cargo)}</span>` : ""}
      <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${hasPhone(x.tel) ? `<a class="btn sm" href="${telHref(x.tel)}">📞 ${esc(x.tel)}</a><a class="btn sm" target="_blank" rel="noopener" href="${waHref(x.tel)}">💬 WhatsApp</a>` : ""}${emailKeys(x.email).map(e => `<a class="btn sm" href="mailto:${esc(e)}">✉ ${esc(e)}</a>`).join("")}</span></div>`).join("")}</div>` : ""}
  <div class="box ${open && st === "none" ? "alert" : ""}">
    <h3>${open ? (st === "none" ? "⚠ Falta la próxima acción" : "Próxima acción") : "Lead cerrado"} ${open && st !== "none" ? dueHtml(l) : ""}</h3>
    ${open ? `${nextFields("na", l)}<div class="row-btns"><button class="btn primary sm" id="naSave">Guardar próxima acción</button></div>` : `<p class="hint" style="margin:0">${esc(l.estado)}${l.cierre ? " el " + esc(nice(l.cierre)) : ""}${l.motivo ? " · Motivo: " + esc(l.motivo) + (l.motivoDetalle ? " (" + esc(l.motivoDetalle) + ")" : "") : ""}. Puedes reabrirlo cambiando el estado.</p>`}
  </div>
  <div class="box"><h3>Estado</h3><div class="stages" id="stg">${S.L.STAGES.map(s => `<button class="${s === l.estado ? "on " + stCls(s) : ""}" data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>
  <div class="box" id="logBox"><h3>Registrar actividad</h3>
    <div class="types" id="actT">${S.L.ACT_TYPES.map((t, i) => `<button type="button" data-v="${t}" class="${i === 0 ? "on" : ""}">${({ Llamada: "📞", WhatsApp: "💬", Email: "✉", Visita: "🚗", Nota: "📝" })[t]} ${t}</button>`).join("")}</div>
    <div class="fgrid">
      <label class="f">Con<select id="actC"><option value="">—</option>${l.contacts.map(x => `<option ${x === c ? "selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select></label>
      <label class="f">Resultado<select id="actR"><option value="">—</option>${S.L.RESULTS.map(r => `<option>${r}</option>`).join("")}</select></label>
      <label class="f wide">Qué ha pasado
        <textarea id="actX" placeholder="Escribe o dicta lo hablado: qué necesita, cantidades, precios, objeciones…"></textarea></label>
    </div>
    <div class="row-btns" style="justify-content:flex-start;margin-top:6px">
      <button type="button" class="btn sm mic ${dict ? "" : "hidden"}" id="micBtn" title="Dictar con la voz (Chrome o Edge)">🎤 Dictar</button>
      <button type="button" class="btn sm ai ${S.ai ? "" : "hidden"}" id="aiBtn" title="Claude limpia el texto, elige el resultado y propone la próxima acción">✨ Ordenar con IA</button>
      <span class="hint" id="micHint"></span>
    </div>
    <div id="aiBar" class="aibar hidden"></div>
    ${open ? `<div style="margin-top:12px"><div class="hint" style="margin-bottom:6px"><b>Siguiente paso</b> (si lo dejas vacío se mantiene el actual${l.accion ? ": " + esc(l.accion) + " " + esc(short(l.accionFecha)) : ""})</div>${nextFields("ac", null)}</div>` : ""}
    <div class="row-btns"><button class="btn primary" id="actSave">Guardar actividad</button></div>
  </div>
  <div class="box"><h3>Historial <span class="hint">${l.acts.length} anotaciones</span></h3>
    <div class="tl">${l.acts.length ? l.acts.map(a => `<div class="tl-i ${a.tipo === "Cambio de estado" ? "sys" : ""}"><div class="d">${esc(dt(a.fecha)).replace("\n", "<br>")}</div>
      <div><div class="h">${a.tipo === "Cambio de estado" ? "↪ " + esc(a.resumen) : `${esc(a.tipo)}${a.resultado ? ` <span class="tag">${esc(a.resultado)}</span>` : ""}${a.contacto ? ` <span class="hint">con ${esc(a.contacto)}</span>` : ""}`} <span class="hint">· ${esc(a.comercial)}</span>
        ${(isAdmin() || a.comercial === S.session.name) && a.tipo !== "Cambio de estado" ? `<button class="btn ghost sm" data-delact="${a.id}" title="Borrar anotación" style="margin-left:auto">🗑</button>` : ""}</div>
      ${a.texto ? `<div class="tx">${esc(a.texto)}</div>` : ""}</div></div>`).join("") : `<div class="empty">Sin actividades todavía.</div>`}</div>
  </div>`;
}
function bindSeg(l) {
  const root = $("#drB");
  root.addEventListener("input", () => { drawerDirty = true; }, { once: false });
  bindDates(root, "na"); bindDates(root, "ac");
  const ns = $("#naSave", root);
  if (ns) ns.onclick = async () => {
    const accion = $("#naAcc", root).value, fecha = $("#naFec", root).value;
    if (accion && !fecha) { toast("Pon una fecha para la próxima acción."); return; }
    ns.disabled = true;
    try { const r = await post({ action: "setNext", id: l.id, accion, fecha, nota: $("#naNot", root).value }); upsertLead(r.lead); drawerDirty = false; toast("Próxima acción guardada"); renderAll(); renderDrawer(); }
    catch (e) { toast(e.message); ns.disabled = false; }
  };
  $("#stg", root).onclick = async e => { const b = e.target.closest("button[data-s]"); if (!b || b.dataset.s === l.estado) return; await moveTo(l.id, b.dataset.s); drawerDirty = false; renderDrawer(); };
  let tipo = "Llamada";
  $("#actT", root).onclick = e => { const b = e.target.closest("button"); if (!b) return; tipo = b.dataset.v; $$("#actT button", root).forEach(x => x.classList.toggle("on", x === b)); };
  if (S.drawer.focusLog) { S.drawer.focusLog = false; setTimeout(() => { $("#logBox", root).scrollIntoView({ block: "start", behavior: "smooth" }); $("#actX", root).focus(); }, 60); }
  $("#micBtn", root).onclick = () => toggleDict($("#actX", root), $("#micBtn", root), $("#micHint", root));
  $("#aiBtn", root).onclick = () => aiTidy(l, root, () => tipo);
  root.onclick = async e => {
    const d = e.target.closest("[data-delact]"); if (!d) return;
    if (!confirmBox("¿Borrar esta anotación del historial?")) return;
    try { await post({ action: "deleteActivity", id: d.dataset.delact }); l.acts = l.acts.filter(a => a.id !== d.dataset.delact); renderDrawer(); toast("Anotación borrada"); } catch (er) { toast(er.message); }
  };
  $("#actSave", root).onclick = async () => {
    const texto = $("#actX", root).value.trim(), resultado = $("#actR", root).value;
    if (!texto && !resultado) { toast("Escribe qué ha pasado o elige un resultado."); $("#actX", root).focus(); return; }
    const acc = $("#acAcc", root), next = acc && acc.value ? { accion: acc.value, fecha: $("#acFec", root).value, nota: $("#acNot", root).value } : null;
    if (next && !next.fecha) { toast("Pon la fecha del siguiente paso."); return; }
    if (isOpen(l) && !next && !l.accion && !confirmBox("Este lead se quedará SIN próxima acción (saldrá en rojo). ¿Guardar igualmente?")) return;
    await stopDict();
    const btn = $("#actSave", root); btn.disabled = true;
    try {
      const r = await post({ action: "addActivity", leadId: l.id, tipo, resultado, texto, contacto: $("#actC", root).value, next });
      upsertLead(r.lead); const L = lead(l.id); L.acts = [r.act, ...L.acts.filter(a => a.id !== r.act.id)];
      drawerDirty = false; toast("Actividad guardada"); renderAll(); renderDrawer(); refresh();
    } catch (e) { toast(e.message); btn.disabled = false; }
  };
}

/* ---------- IA: ordenar la nota y proponer la próxima acción ---------- */
let aiCtl = null;
async function aiTidy(l, root, getTipo) {
  const btn = $("#aiBtn", root), ta = $("#actX", root), hint = $("#micHint", root);
  if (aiCtl) { aiCtl.abort(); return; }
  const text = ta.value.trim();
  if (text.length < 15) { hint.textContent = "Escribe o dicta primero lo que ha pasado; después pulsa «Ordenar con IA»."; return; }
  await stopDict();
  const T = todayS();
  const hist = l.acts.filter(a => a.tipo !== "Cambio de estado").slice(0, 5).map(a => `- ${String(a.fecha).slice(0, 10)} ${a.tipo}${a.resultado ? " (" + a.resultado + ")" : ""}: ${String(a.texto).slice(0, 300)}`).join("\n");
  const prompt = `Eres el asistente comercial de Volta Baterías (empresa española que repara baterías de litio y vende baterías de litio y de plomo: coche, moto, camión, AGM, EFB, tracción). El comercial ha dictado (hablando) una nota sobre una ${getTipo().toLowerCase()} con un cliente potencial. Límpiala y propón el siguiente paso.

Reglas:
- No inventes nada que no se diga. Conserva TODOS los datos concretos: nombres, cantidades, modelos, precios, fechas, marcas.
- Quita muletillas y repeticiones. Frases cortas en español de España. Puedes usar viñetas con "- " si hay varios puntos.
- El campo "resultado" debe ser exactamente uno de: ${S.L.RESULTS.join(", ")} (o null si no se sabe).
- "proxima_accion.tipo" debe ser exactamente uno de: ${S.L.ACTIONS.join(", ")} (o null si no hay un siguiente paso claro).
- Para fechas relativas ("el jueves", "la semana que viene", "a final de mes") usa la primera fecha que encaje a partir de hoy, en días laborables. Si se dice que hay que volver a llamar pero no cuándo, propón dentro de 3 días laborables.

Devuelve SOLO un objeto JSON:
{"texto": "nota limpia", "resultado": "..." o null, "proxima_accion": {"tipo": "..." o null, "fecha": "AAAA-MM-DD" o null, "nota": "frase corta de qué hacer"}}

Hoy es ${nice(T)} (${T}).
Cliente: ${l.empresa} (${l.tipo || "sin tipo"}, línea ${l.linea || "sin definir"}, estado ${l.estado}).
Últimas actividades:
${hist || "(ninguna)"}

Nota dictada:
"""
${text.slice(0, 8000)}
"""`;
  aiCtl = new AbortController();
  btn.classList.add("busy"); btn.textContent = "■ Ordenando… (parar)"; hint.textContent = "Claude está ordenando la nota…";
  try {
    const r = await call("ai", { method: "POST", body: { prompt }, signal: aiCtl.signal });
    const j = parseJsonLoose(r.text);
    const clean = typeof j.texto === "string" ? j.texto.trim() : "";
    if (!clean) throw new Error("Respuesta vacía");
    const orig = ta.value; ta.value = clean; drawerDirty = true; hint.textContent = "";
    const res = S.L.RESULTS.includes(j.resultado) ? j.resultado : null;
    const na = j.proxima_accion || {};
    const acc = S.L.ACTIONS.includes(na.tipo) ? na.tipo : null, fec = /^\d{4}-\d{2}-\d{2}$/.test(na.fecha || "") ? na.fecha : null, nota = typeof na.nota === "string" ? na.nota.trim().slice(0, 200) : "";
    if (res) $("#actR", root).value = res;
    const bar = $("#aiBar", root);
    const sug = acc && $("#acAcc", root) ? `<button type="button" class="btn sm" data-ai="next">Siguiente paso: ${esc(acc)}${fec ? " · " + esc(nice(fec)) : ""}${nota ? " — " + esc(nota) : ""}</button>` : "";
    bar.innerHTML = `<span>✨ Ordenado por Claude${res ? ` · resultado: <b>${esc(res)}</b>` : ""}. Revísalo antes de guardar.</span>${sug}<button type="button" class="btn ghost sm" data-ai="undo">↺ Volver al original</button>`;
    bar.classList.remove("hidden");
    bar.onclick = e => {
      const b = e.target.closest("[data-ai]"); if (!b) return;
      if (b.dataset.ai === "next") { $("#acAcc", root).value = acc; if (fec) $("#acFec", root).value = fec; if (nota) $("#acNot", root).value = nota; b.remove(); }
      if (b.dataset.ai === "undo") { ta.value = orig; bar.classList.add("hidden"); }
    };
  } catch (e) {
    hint.textContent = e.name === "AbortError" ? "Cancelado." : e.status === 501 ? "La IA no está configurada (falta ANTHROPIC_API_KEY en Netlify)." : e.status === 429 ? "Demasiadas peticiones; espera un momento." : "No se pudo ordenar el texto. Inténtalo de nuevo.";
  } finally { aiCtl = null; btn.classList.remove("busy"); btn.textContent = "✨ Ordenar con IA"; }
}
function parseJsonLoose(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("JSON no válido");
}

/* ---------- dictado (reconocimiento de voz del navegador, como en el calendario) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const dict = !!SR;
let rec = null, recTa = null, recBtn = null, recBase = "";
function toggleDict(ta, btn, hint) {
  if (rec) { stopDict(); return; }
  if (!SR) { hint.textContent = "El dictado funciona en Google Chrome o Microsoft Edge."; return; }
  recTa = ta; recBtn = btn; recBase = ta.value ? ta.value.replace(/\s*$/, "") + " " : "";
  rec = new SR(); rec.lang = "es-ES"; rec.continuous = true; rec.interimResults = true;
  let finalTxt = "";
  rec.onresult = ev => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) finalTxt += (finalTxt ? " " : "") + r[0].transcript.trim(); else interim += r[0].transcript; }
    recTa.value = recBase + finalTxt + (interim ? " " + interim : ""); drawerDirty = true;
  };
  rec.onerror = ev => { if (ev.error === "not-allowed" || ev.error === "service-not-allowed") hint.textContent = "El navegador no tiene permiso para usar el micrófono."; };
  rec.onend = () => { if (recBtn) { recBtn.classList.remove("on"); recBtn.textContent = "🎤 Dictar"; } rec = null; };
  try { rec.start(); btn.classList.add("on"); btn.textContent = "■ Parar dictado"; hint.textContent = "Escuchando… habla con normalidad."; } catch (e) { rec = null; hint.textContent = "No se pudo iniciar el dictado."; }
}
function stopDict() { return new Promise(r => { if (!rec) return r(); const x = rec; x.onend = () => { if (recBtn) { recBtn.classList.remove("on"); recBtn.textContent = "🎤 Dictar"; } rec = null; r(); }; try { x.stop(); } catch (e) { rec = null; r(); } setTimeout(r, 1500); }); }

/* ---------- pestaña Ficha ---------- */
function sel(id, list, v, empty = "—") { return `<select id="${id}"><option value="">${empty}</option>${list.map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`; }
function productsHtml(linea, chosen) {
  const groups = linea === "Litio" ? ["Litio"] : linea === "Plomo" ? ["Plomo"] : ["Litio", "Plomo"];
  return groups.map(g => `<div style="margin-top:6px"><div class="hint" style="margin-bottom:4px">${lnPill(g)}</div><div class="types">${S.L.PRODUCTS[g].map(p => `<button type="button" data-p="${esc(p)}" class="${chosen.includes(p) ? "on" : ""}">${esc(p.replace(/^\w+ · /, ""))}</button>`).join("")}</div></div>`).join("");
}
function fichaHtml(l) {
  const ctRow = c => `<div class="ct" data-cid="${esc(c.id || "")}"><input data-k="nombre" placeholder="Nombre / cargo" value="${esc(c.nombre)}"><input data-k="cargo" placeholder="Cargo / área" value="${esc(c.cargo)}"><input data-k="tel" placeholder="Teléfono" value="${esc(c.tel)}"><input data-k="email" placeholder="Email" value="${esc(c.email)}"><span style="display:flex;gap:4px;align-items:center"><label title="Contacto principal"><input type="radio" name="princ" ${c.principal ? "checked" : ""}></label><button type="button" class="btn ghost sm" data-delc title="Quitar">✕</button></span></div>`;
  return `
  <div class="box"><h3>Datos</h3><div class="fgrid">
    <label class="f wide">Nombre / empresa <span class="req">*</span><input id="fEmp" value="${esc(l.empresa)}"></label>
    <label class="f">Grupo<input id="fGrupo" value="${esc(l.grupo)}" placeholder="Ej.: GAM"></label>
    <label class="f">CIF<input id="fCif" value="${esc(l.cif)}"></label>
    <label class="f">País${sel("fPais", S.L.COUNTRIES, l.pais)}</label>
    <label class="f">Provincia<input id="fProv" value="${esc(l.provincia)}"></label>
    <label class="f">Ciudad<input id="fCiu" value="${esc(l.ciudad)}"></label>
    <label class="f">Web<input id="fWeb" value="${esc(l.web)}"></label>
  </div></div>
  <div class="box"><h3>Clasificación</h3><div class="fgrid">
    <label class="f">Línea<div class="seg" id="fLinea" style="align-self:flex-start">${S.L.LINES.map(x => `<button type="button" data-val="${x}" class="${l.linea === x ? "on" : ""}"><span class="lnd ${x}"></span>${x}</button>`).join("")}</div></label>
    <label class="f">Tipo de cliente${sel("fTipo", S.L.TYPES, l.tipo)}</label>
    <label class="f">Origen${sel("fOri", S.L.ORIGINS, l.origen)}</label>
    <label class="f">Potencial${sel("fPot", S.L.POTENTIAL, l.potencial)}</label>
    <label class="f">Valor estimado (€)<input id="fVal" type="number" min="0" step="100" value="${l.valor || ""}"></label>
    <label class="f">Probabilidad (%)<input id="fProb" type="number" min="0" max="100" step="5" value="${l.prob ?? ""}" placeholder="auto: ${defProb(l.estado)} %"></label>
    ${isAdmin() ? `<label class="f">Comercial asignado${sel("fCom", salesNames(), l.comercial, "Sin asignar")}</label>` : ""}
    <label class="f wide">Productos de interés<div id="fProd">${productsHtml(l.linea, l.productos)}</div></label>
    ${l.linea !== "Litio" ? `<label class="f wide">Marcas (plomo)<div class="types" id="fMar">${S.L.BRANDS.map(b => `<button type="button" data-b="${b}" class="${l.marcas.includes(b) ? "on" : ""}">${b}</button>`).join("")}</div></label>` : ""}
  </div></div>
  <div class="box"><h3>Contactos <button type="button" class="btn sm" id="addC">＋ Añadir persona</button></h3><div id="cts">${l.contacts.map(ctRow).join("") || ""}</div>
    <div class="hint">Marca con el círculo el contacto principal.</div></div>
  <div class="box"><h3>Notas</h3><textarea class="inp" id="fNotas" style="width:100%">${esc(l.notas)}</textarea></div>
  <div class="box"><h3>Adjuntos <label class="btn sm">＋ Subir<input type="file" id="fFile" multiple hidden></label></h3>
    <div id="atts">${attsHtml(l.adjuntos)}</div><div class="hint" id="upHint">Presupuestos, fotos, fichas técnicas… (máx. 4 MB por archivo).</div></div>
  <div class="box"><h3>Integraciones <span class="hint">próximamente</span></h3><div class="fgrid">
    <label class="f">Id en Holded<input id="fHol" value="${esc(l.holdedId)}" ${isAdmin() ? "" : "disabled"}></label>
    <label class="f">Id en Kommo<input id="fKom" value="${esc(l.kommoId)}" ${isAdmin() ? "" : "disabled"}></label>
    <label class="f">Tarea de ClickUp<input id="fCu" value="${esc(l.clickup)}" placeholder="https://app.clickup.com/t/…" ${isAdmin() ? "" : "disabled"}></label>
  </div></div>
  <div class="box" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;bottom:0">
    <span class="hint" style="margin-right:auto">Alta: ${esc(nice(String(l.alta || "").slice(0, 10)))}${l.primerContacto ? " · 1er contacto: " + esc(nice(String(l.primerContacto).slice(0, 10))) : " · sin contactar"}${l.ref ? " · Ref. Excel " + esc(l.ref) : ""}</span>
    ${isAdmin() ? `<button class="btn danger" id="fDel">Borrar lead</button>` : ""}
    <button class="btn primary" id="fSave">Guardar ficha</button>
  </div>`;
}
const attsHtml = list => (list || []).map((a, i) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><a href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a><button type="button" class="btn ghost sm" data-dela="${i}">✕</button></div>`).join("") || `<div class="hint">Sin adjuntos.</div>`;
function bindFicha(l) {
  const root = $("#drB");
  let linea = l.linea, productos = [...l.productos], marcas = [...l.marcas], adjuntos = [...l.adjuntos];
  root.addEventListener("input", () => { drawerDirty = true; });
  $("#fLinea", root).onclick = e => { const b = e.target.closest("button"); if (!b) return; linea = b.dataset.val; $$("#fLinea button", root).forEach(x => x.classList.toggle("on", x === b)); $("#fProd", root).innerHTML = productsHtml(linea, productos); drawerDirty = true; };
  $("#fProd", root).onclick = e => { const b = e.target.closest("[data-p]"); if (!b) return; const p = b.dataset.p; productos = productos.includes(p) ? productos.filter(x => x !== p) : [...productos, p]; b.classList.toggle("on"); drawerDirty = true; };
  const fm = $("#fMar", root); if (fm) fm.onclick = e => { const b = e.target.closest("[data-b]"); if (!b) return; const p = b.dataset.b; marcas = marcas.includes(p) ? marcas.filter(x => x !== p) : [...marcas, p]; b.classList.toggle("on"); drawerDirty = true; };
  const deleted = [];
  $("#addC", root).onclick = () => { $("#cts", root).insertAdjacentHTML("beforeend", `<div class="ct" data-cid=""><input data-k="nombre" placeholder="Nombre / cargo"><input data-k="cargo" placeholder="Cargo / área"><input data-k="tel" placeholder="Teléfono"><input data-k="email" placeholder="Email"><span style="display:flex;gap:4px;align-items:center"><label title="Contacto principal"><input type="radio" name="princ" ${$$(".ct", root).length ? "" : "checked"}></label><button type="button" class="btn ghost sm" data-delc>✕</button></span></div>`); $$(".ct", root).at(-1).querySelector("input").focus(); drawerDirty = true; };
  $("#cts", root).onclick = e => { const d = e.target.closest("[data-delc]"); if (!d) return; const row = d.closest(".ct"); if (row.dataset.cid) deleted.push(row.dataset.cid); row.remove(); drawerDirty = true; };
  $("#atts", root).onclick = e => { const d = e.target.closest("[data-dela]"); if (!d) return; adjuntos.splice(Number(d.dataset.dela), 1); $("#atts", root).innerHTML = attsHtml(adjuntos); drawerDirty = true; };
  $("#fFile", root).onchange = async e => {
    for (const file of e.target.files) {
      if (file.size > 4 * 1024 * 1024) { toast(`${file.name}: supera 4 MB`); continue; }
      $("#upHint", root).textContent = `Subiendo ${file.name}…`;
      try { const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(file); });
        const r = await call("upload", { method: "POST", body: { filename: file.name, contentType: file.type || "application/octet-stream", data } });
        adjuntos.push({ url: r.url, name: r.name, contentType: r.contentType }); $("#atts", root).innerHTML = attsHtml(adjuntos); drawerDirty = true;
      } catch (er) { toast(er.message); }
    }
    $("#upHint", root).textContent = "Pulsa «Guardar ficha» para guardar los adjuntos."; e.target.value = "";
  };
  const fd = $("#fDel", root);
  if (fd) fd.onclick = async () => {
    if (!confirmBox(`¿Borrar «${l.empresa}» con sus contactos y su historial? No se puede deshacer.`)) return;
    try { await post({ action: "deleteLead", id: l.id }); S.leads = S.leads.filter(x => x.id !== l.id); drawerDirty = false; closeDrawer(); renderAll(); toast("Lead borrado"); } catch (e) { toast(e.message); }
  };
  $("#fSave", root).onclick = async () => {
    const empresa = $("#fEmp", root).value.trim();
    if (!empresa) { toast("Falta el nombre."); $("#fEmp", root).focus(); return; }
    const contacts = $$(".ct", root).map(r => ({ id: r.dataset.cid || undefined, principal: r.querySelector('input[type=radio]').checked, ...Object.fromEntries($$("input[data-k]", r).map(i => [i.dataset.k, i.value.trim()])) }));
    deleted.forEach(id => contacts.push({ id, _delete: true }));
    const body = { empresa, grupo: $("#fGrupo", root).value, cif: $("#fCif", root).value, pais: $("#fPais", root).value, provincia: $("#fProv", root).value, ciudad: $("#fCiu", root).value, web: $("#fWeb", root).value,
      linea, tipo: $("#fTipo", root).value, origen: $("#fOri", root).value, potencial: $("#fPot", root).value, valor: $("#fVal", root).value, prob: $("#fProb", root).value === "" ? null : $("#fProb", root).value,
      productos: productos.filter(p => linea === "Ambas" || !linea || p.startsWith(linea)), marcas: linea === "Litio" ? [] : marcas, notas: $("#fNotas", root).value, adjuntos };
    if (isAdmin()) { body.comercial = $("#fCom", root).value; body.holdedId = $("#fHol", root).value; body.kommoId = $("#fKom", root).value; body.clickup = $("#fCu", root).value; }
    // duplicados (solo aviso)
    const c0 = contacts.find(c => !c._delete && (c.tel || c.email)) || {};
    try {
      const dd = await post({ action: "dupes", tel: contacts.filter(c => !c._delete).map(c => c.tel).join(" "), email: contacts.filter(c => !c._delete).map(c => c.email).join(" "), cif: body.cif, empresa: "", excludeId: l.id });
      const extra = (dd.dupes || []);
      if (extra.length && !confirmBox("Atención, posible duplicado:\n" + extra.map(x => `· ${x.empresa} (${x.why.join(", ")}${x.comercial ? ", de " + x.comercial : ""})`).join("\n") + "\n\n¿Guardar igualmente?")) return;
    } catch (e) {}
    void c0;
    const btn = $("#fSave", root); btn.disabled = true;
    try { const r = await post({ action: "saveLead", id: l.id, lead: body, contacts }); upsertLead(r.lead); drawerDirty = false; toast("Ficha guardada"); await refresh(); renderDrawer(); }
    catch (e) { toast(e.message); btn.disabled = false; }
  };
}

/* =================== ALTA RÁPIDA =================== */
function modal(html, onCancel) {
  const wrap = document.createElement("div"); wrap.className = "modal-shade"; wrap.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(wrap);
  const m = { el: wrap, close(ok) { wrap.remove(); document.removeEventListener("keydown", key); if (!ok && onCancel) onCancel(); } };
  const key = e => { if (e.key === "Escape") m.close(false); };
  document.addEventListener("keydown", key);
  wrap.addEventListener("click", e => { if (e.target === wrap || e.target.closest("[data-x]")) m.close(false); });
  return m;
}
function openQuickAdd() {
  const L = S.L;
  const m = modal(`<div class="m-h"><h2>Nuevo lead</h2><button class="btn ghost" data-x>✕</button></div>
  <form class="m-b" id="qa" autocomplete="off">
    <label class="f">Nombre / empresa <span class="req">*</span><input id="qEmp" required placeholder="Ej.: Talleres García"></label>
    <div class="fgrid">
      <label class="f">Persona de contacto<input id="qCon" placeholder="Nombre"></label>
      <label class="f">Teléfono<input id="qTel" inputmode="tel" placeholder="600 000 000"></label>
      <label class="f">Email<input id="qMail" type="email" placeholder="correo@empresa.es"></label>
      <label class="f">CIF (opcional)<input id="qCif"></label>
    </div>
    <div id="qDup"></div>
    <label class="f">Línea<div class="seg" id="qLin" style="align-self:flex-start">${L.LINES.map(x => `<button type="button" data-val="${x}"><span class="lnd ${x}"></span>${x}</button>`).join("")}</div></label>
    <div class="fgrid">
      <label class="f">Tipo de cliente${sel("qTipo", L.TYPES, "")}</label>
      <label class="f">Origen${sel("qOri", L.ORIGINS, "")}</label>
      <label class="f">Provincia / ciudad<input id="qZona"></label>
      <label class="f">Valor estimado (€)<input id="qVal" type="number" min="0" step="100"></label>
      ${isAdmin() ? `<label class="f">Comercial${sel("qCom", salesNames(), salesNames()[0] || "", "Sin asignar")}</label>` : ""}
    </div>
    <div><div class="hint" style="margin-bottom:6px"><b>Próxima acción</b> (obligatoria para que no salga en rojo)</div>${nextFields("qn", { accion: "Llamar", accionFecha: todayS() })}</div>
    <label class="f">Nota (opcional)<textarea id="qNota" style="min-height:60px" placeholder="Qué necesita, de dónde viene…"></textarea></label>
  </form>
  <div class="m-f"><span class="hint" style="margin-right:auto">Intro = guardar</span><button class="btn" data-x>Cancelar</button><button class="btn primary" id="qSave">Guardar lead</button></div>`);
  const el = m.el; let linea = "";
  setTimeout(() => $("#qEmp", el).focus(), 30);
  $("#qLin", el).onclick = e => { const b = e.target.closest("button"); if (!b) return; linea = linea === b.dataset.val ? "" : b.dataset.val; $$("#qLin button", el).forEach(x => x.classList.toggle("on", x.dataset.val === linea)); };
  bindDates(el, "qn");
  let dupT, dupes = [];
  const checkDup = () => { clearTimeout(dupT); dupT = setTimeout(async () => {
    const q = { tel: $("#qTel", el).value, email: $("#qMail", el).value, cif: $("#qCif", el).value, empresa: $("#qEmp", el).value };
    if (!phoneKey(q.tel) && !emailKeys(q.email).length && cifKey(q.cif).length < 5 && nameKey(q.empresa).length < 4) { $("#qDup", el).innerHTML = ""; dupes = []; return; }
    try { const r = await post({ action: "dupes", ...q }); dupes = r.dupes || []; } catch (e) { dupes = []; }
    $("#qDup", el).innerHTML = dupes.length ? `<div class="dupbox"><b>⚠ Posible duplicado:</b> ${dupes.map(d => `<div>· <b>${esc(d.empresa)}</b> — coincide ${esc(d.why.join(", "))}${d.comercial ? ` · de ${esc(d.comercial)}` : ""} · ${esc(d.estado)} ${lead(d.id) ? `<a href="#" data-opendup="${d.id}">abrir</a>` : ""}</div>`).join("")}<div class="hint" style="margin-top:4px">Si es otra delegación u otra persona, puedes guardarlo igualmente.</div></div>` : "";
  }, 450); };
  ["qTel", "qMail", "qCif", "qEmp"].forEach(id => $("#" + id, el).addEventListener("input", checkDup));
  $("#qDup", el).onclick = e => { const a = e.target.closest("[data-opendup]"); if (!a) return; e.preventDefault(); m.close(true); openDrawer(a.dataset.opendup); };
  $("#qa", el).onsubmit = e => { e.preventDefault(); $("#qSave", el).click(); };
  el.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); $("#qSave", el).click(); } });
  $("#qSave", el).onclick = async () => {
    const empresa = $("#qEmp", el).value.trim();
    if (!empresa) { $("#qEmp", el).focus(); toast("Falta el nombre."); return; }
    const accion = $("#qnAcc", el).value, fecha = $("#qnFec", el).value;
    if (accion && !fecha) { toast("Pon la fecha de la próxima acción."); return; }
    if (dupes.length && !confirmBox(`Hay ${dupes.length} posible(s) duplicado(s). ¿Crear el lead igualmente?`)) return;
    const zonaV = $("#qZona", el).value.trim();
    const body = { empresa, linea, tipo: $("#qTipo", el).value, origen: $("#qOri", el).value, valor: $("#qVal", el).value, cif: $("#qCif", el).value, ciudad: zonaV, pais: "España",
      accion, accionFecha: fecha, accionNota: $("#qnNot", el).value, notas: $("#qNota", el).value };
    if (isAdmin()) body.comercial = $("#qCom", el).value;
    const tel = $("#qTel", el).value.trim(), email = $("#qMail", el).value.trim(), con = $("#qCon", el).value.trim();
    const contacts = (con || tel || email) ? [{ nombre: con || "Contacto", tel, email, principal: true }] : [];
    const btn = $("#qSave", el); btn.disabled = true;
    try { const r = await post({ action: "saveLead", lead: body, contacts }); m.close(true); toast(`Lead «${empresa}» creado`); await refresh(); openDrawer(r.id); }
    catch (e) { toast(e.message); btn.disabled = false; }
  };
}

/* =================== AJUSTES (administrador) =================== */
function renderSettings() {
  const root = $("#v-ajustes");
  root.innerHTML = `<div class="grid2">
    <div class="card"><div class="card-h"><h2>Usuarios y códigos</h2><span class="sub">Cada código: 6 números, distinto para cada persona</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Rol</th><th>Activo</th><th>Nuevo código</th><th></th></tr></thead><tbody>
      ${S.users.map(u => `<tr data-rid="${u.rid}"><td><b>${esc(u.name)}</b></td><td>${u.role === "admin" ? "Administrador" : "Comercial"}</td>
        <td>${u.role === "admin" ? "Sí" : `<input type="checkbox" data-act ${u.active ? "checked" : ""}>`}</td>
        <td><input class="inp mono" data-code maxlength="6" inputmode="numeric" placeholder="••••••" style="width:110px;padding:5px 8px"></td>
        <td><button class="btn sm" data-saveu>Guardar</button></td></tr>`).join("")}
      </tbody></table></div>
      <div style="padding:14px 20px;border-top:1px solid var(--line)"><b>Añadir comercial</b>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><input class="inp" id="nuName" placeholder="Nombre"><input class="inp mono" id="nuCode" maxlength="6" inputmode="numeric" placeholder="Código (6 números)" style="width:180px"><button class="btn primary sm" id="nuSave">Añadir</button></div>
        <p class="hint">El comercial nuevo entrará con su código y solo verá los leads que le asignes (en la ficha o con «Reasignar» en la Lista).</p></div>
    </div>
    <div class="card"><div class="card-h"><h2>Importar leads</h2><span class="sub">Desde CSV o Excel</span></div>
      <div style="padding:16px 20px">
        <p style="margin-top:0">Sube un archivo con una fila por empresa. Podrás elegir qué columna es cada dato y verás los duplicados antes de importar.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" id="tplBtn" href="plantilla-leads.xlsx" download="Plantilla leads Comercial Volta.xlsx" title="Excel con las columnas correctas y listas desplegables">⤓ Descargar plantilla Excel</a>
          <label class="btn primary">⇪ Elegir archivo (.csv, .xlsx)<input type="file" id="impFile" accept=".csv,.txt,.xlsx,.xls" hidden></label>
        </div>
        <p class="hint" style="margin-bottom:0">Consejo: descarga la plantilla, rellena una fila por empresa en la hoja «Leads» y súbela aquí. Solo «Empresa» es obligatoria.</p>
        <div id="impArea" style="margin-top:14px"></div>
      </div></div>
  </div>`;
  $$("[data-saveu]", root).forEach(b => b.onclick = async () => {
    const tr = b.closest("tr"), u = S.users.find(x => x.rid === tr.dataset.rid), code = $("[data-code]", tr).value.trim(), act = $("[data-act]", tr);
    if (code && !/^\d{6}$/.test(code)) { toast("El código tiene que tener 6 números."); return; }
    b.disabled = true;
    try { await post({ action: "saveUser", user: { rid: u.rid, name: u.name, code: code || undefined, active: act ? act.checked : true } }); toast(code ? `Código de ${u.name} cambiado` : "Guardado"); await refresh(); }
    catch (e) { toast(e.message); b.disabled = false; }
  });
  $("#nuSave", root).onclick = async () => {
    const name = $("#nuName", root).value.trim(), code = $("#nuCode", root).value.trim();
    if (!name || !/^\d{6}$/.test(code)) { toast("Escribe el nombre y un código de 6 números."); return; }
    try { await post({ action: "saveUser", user: { name, code } }); toast(`${name} añadido`); await refresh(); } catch (e) { toast(e.message); }
  };
  $("#impFile", root).onchange = e => { const f = e.target.files[0]; if (f) startImport(f, $("#impArea", root)); e.target.value = ""; };
}

/* ---------- importación ---------- */
const IMP_FIELDS = [
  ["empresa", "Empresa / nombre *", /empresa|raz[oó]n|cliente|nombre comercial|company|^nombre$/],
  ["contacto", "Persona de contacto", /contacto clave|persona|contacto$|interlocutor|^contacto/],
  ["cargo", "Cargo / área", /cargo|puesto|[aá]rea|departamento/],
  ["tel", "Teléfono", /tel[eé]fono|m[oó]vil|phone|tlf|whatsapp/],
  ["email", "Email", /e-?mail|correo/],
  ["cif", "CIF", /cif|nif|vat/],
  ["pais", "País", /pa[ií]s|country/],
  ["provincia", "Provincia", /provincia|regi[oó]n/],
  ["ciudad", "Ciudad / sede", /ciudad|poblaci[oó]n|localidad|sede|municipio/],
  ["web", "Web", /web|url|p[aá]gina/],
  ["tipo", "Tipo de cliente", /tipo|sector|negocio|segmento/],
  ["linea", "Línea", /l[ií]nea|litio|plomo/],
  ["origen", "Origen", /origen|fuente|canal/],
  ["valor", "Valor estimado (€)", /valor|importe|€|potencial €|oportunidad/],
  ["potencial", "Potencial", /^potencial/],
  ["accion", "Próxima acción", /^proxima accion$|^accion$|siguiente paso/],
  ["accionFecha", "Fecha próxima acción", /fecha/],
  ["notas", "Notas", /^notas?$|observ|comentario/],
];
// Fecha de Excel o CSV -> AAAA-MM-DD (acepta 25/11/2026, 25-11-26, 2026-11-25 y nº de serie de Excel)
function impDate(v) {
  const s = String(v || "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5); return d.toISOString().slice(0, 10); }
  return "";
}
function parseCsv(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || "";
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : (first.includes("\t") ? "\t" : ",");
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error("No se pudo cargar el lector de Excel. Guarda el archivo como CSV e inténtalo de nuevo.")); document.head.appendChild(s); });
}
async function startImport(file, area) {
  area.innerHTML = `<div class="hint">Leyendo ${esc(file.name)}…</div>`;
  let sheets = {};
  try {
    if (/\.xlsx?$/i.test(file.name)) {
      const X = await loadSheetJs(); const wb = X.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      for (const n of wb.SheetNames) sheets[n] = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" });
    } else sheets["CSV"] = parseCsv(await file.text());
  } catch (e) { area.innerHTML = `<div class="err-banner">${esc(e.message)}</div>`; return; }
  const names = Object.keys(sheets).filter(n => sheets[n].some(r => r.filter(c => String(c).trim()).length >= 2));
  if (!names.length) { area.innerHTML = `<div class="err-banner">El archivo no tiene datos.</div>`; return; }
  // hoja por defecto: la que tenga más filas con una columna «empresa»
  const score = n => { const h = headerRow(sheets[n]); return h < 0 ? 0 : sheets[n].length - h; };
  let sheet = names.find(n => /^leads$/i.test(n)) || names.slice().sort((a, b) => score(b) - score(a))[0];
  const draw = () => {
    const rowsAll = sheets[sheet]; const h = Math.max(0, headerRow(rowsAll));
    const head = rowsAll[h].map(c => String(c).trim());
    const data = rowsAll.slice(h + 1).filter(r => r.some(c => String(c).trim()));
    const map = {}; IMP_FIELDS.forEach(([k, , re]) => { const i = head.findIndex((c, j) => re.test(norm(c)) && !Object.values(map).includes(j)); if (i >= 0) map[k] = i; });
    const render = () => {
      const rows = data.map(r => buildImpRow(r, map)).filter(r => r.empresa);
      const seen = new Map();
      rows.forEach(r => { r.dup = localDupes(r); const k = nameKey(r.empresa) + "|" + phoneKey(r.tel); if (seen.has(k)) r.dup.push("repetido en el archivo"); seen.set(k, 1); });
      const ndup = rows.filter(r => r.dup.length).length;
      area.innerHTML = `
        ${names.length > 1 ? `<label class="f" style="margin-bottom:10px">Hoja del Excel<select id="impSheet">${names.map(n => `<option ${n === sheet ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>` : ""}
        <details open><summary><b>Columnas</b> <span class="hint">(revisa que cada dato apunte a la columna correcta)</span></summary>
        <div class="fgrid" style="margin:10px 0">${IMP_FIELDS.map(([k, t]) => `<label class="f">${esc(t)}<select data-map="${k}"><option value="">— no importar —</option>${head.map((c, i) => `<option value="${i}" ${map[k] === i ? "selected" : ""}>${esc(c || "Columna " + (i + 1))}</option>`).join("")}</select></label>`).join("")}</div></details>
        <div class="fgrid" style="margin:10px 0">
          <label class="f">Asignar a${sel("impCom", salesNames(), salesNames()[0] || "", "Sin asignar")}</label>
          <label class="f">Origen si no viene en el archivo${sel("impOri", S.L.ORIGINS, "Prospección comercial")}</label>
          <label class="f">Línea si no viene${sel("impLin", S.L.LINES, "")}</label>
        </div>
        <label class="hint" style="display:flex;gap:6px;align-items:center;margin-bottom:10px"><input type="checkbox" id="impSkip" checked> No importar los ${ndup} posibles duplicados</label>
        <div class="tbl-wrap" style="max-height:340px;border:1px solid var(--line);border-radius:6px"><table class="tbl"><thead><tr><th>Empresa</th><th>Contacto</th><th>Teléfono</th><th>Email</th><th>Tipo</th><th>Línea</th><th>Valor</th><th>Próxima acción</th><th>¿Duplicado?</th></tr></thead><tbody>
          ${rows.slice(0, 200).map(r => `<tr style="${r.dup.length ? "background:#fff8e6" : ""}"><td><b>${esc(r.empresa)}</b><div class="hint">${esc([r.ciudad, r.pais].filter(Boolean).join(" · "))}</div></td><td>${esc(r.contacto)}</td><td class="mono">${esc(r.tel)}</td><td>${esc(r.email)}</td><td>${esc(r.tipo)}</td><td>${r.linea ? lnPill(r.linea) : ""}</td><td class="num">${r.valor ? eur(r.valor) : ""}</td><td>${r.accion ? esc(r.accion + " · " + short(r.accionFecha)) : `<span class="noact">sin acción</span>`}</td><td>${r.dup.length ? `<span style="color:var(--warn);font-weight:600">${esc(r.dup.join("; "))}</span>` : "—"}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="row-btns"><span class="hint" id="impMsg" style="margin-right:auto">${rows.length} filas con nombre${rows.length > 200 ? " (vista previa de 200)" : ""} · ${ndup} posibles duplicados</span><button class="btn primary" id="impGo" ${rows.length ? "" : "disabled"}>Importar</button></div>`;
      const ss = $("#impSheet", area); if (ss) ss.onchange = () => { sheet = ss.value; draw(); };
      $$("[data-map]", area).forEach(s => s.onchange = () => { if (s.value === "") delete map[s.dataset.map]; else map[s.dataset.map] = Number(s.value); render(); });
      $("#impGo", area).onclick = async () => {
        const skip = $("#impSkip", area).checked, com = $("#impCom", area).value, ori = $("#impOri", area).value, lin = $("#impLin", area).value;
        const todo = rows.filter(r => !(skip && r.dup.length)).map(r => ({ ...r, comercial: com, origen: r.origen || ori, linea: r.linea || lin, dup: undefined }));
        if (!todo.length) { toast("No queda nada que importar."); return; }
        if (!confirmBox(`¿Importar ${todo.length} leads${com ? " asignados a " + com : ""}?`)) return;
        const btn = $("#impGo", area); btn.disabled = true; let done = 0;
        try {
          for (let i = 0; i < todo.length; i += 40) { await post({ action: "importLeads", rows: todo.slice(i, i + 40) }); done = Math.min(todo.length, i + 40); $("#impMsg", area).textContent = `Importando… ${done} de ${todo.length}`; }
          toast(`${todo.length} leads importados`); area.innerHTML = `<div class="hint">✓ ${todo.length} leads importados como «Nuevo».</div>`; await refresh();
        } catch (e) { $("#impMsg", area).textContent = `Error tras ${done} leads: ${e.message}`; btn.disabled = false; await refresh(); }
      };
    };
    render();
  };
  draw();
}
function headerRow(rows) { for (let i = 0; i < Math.min(rows.length, 15); i++) { const r = rows[i].map(c => norm(c)); if (r.filter(Boolean).length >= 2 && r.some(c => /empresa|cliente|nombre|company|raz/.test(c))) return i; } return rows.length ? 0 : -1; }
function fuzzy(v, list) { const n = norm(v).trim(); if (!n) return ""; return list.find(x => norm(x) === n) || list.find(x => norm(x).startsWith(n) || n.startsWith(norm(x))) || list.find(x => n.includes(norm(x).split(/[ /]/)[0])) || ""; }
function buildImpRow(r, map) {
  const g = k => map[k] === undefined ? "" : String(r[map[k]] ?? "").trim();
  const tipoRaw = g("tipo");
  const TYPE_ALIAS = { "alquiler maquinaria": "Alquiler de maquinaria", "vehiculos de ocasion": "Vehículos de ocasión", "distribucion baterias": "Distribución de baterías", "rent a car": "Rent a car", "carretillas": "Carretillas / manutención", "manutencion": "Carretillas / manutención", "vtc": "Flotas VTC", "taller": "Taller", "concesionario": "Concesionario", "tienda": "Tienda / distribuidor", "distribuidor": "Tienda / distribuidor", "particular": "Particular", "marketplace": "Marketplace", "industrial": "Vehículos industriales" };
  const tn = norm(tipoRaw); const tipo = fuzzy(tipoRaw, S.L.TYPES) || Object.entries(TYPE_ALIAS).find(([k]) => tn.includes(k))?.[1] || "";
  const pais = fuzzy(g("pais"), S.L.COUNTRIES) || (String(g("tel")).startsWith("+351") ? "Portugal" : g("pais") ? "Otro" : "");
  const valor = Number(String(g("valor")).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) || 0;
  const notas = [g("notas"), tipoRaw && !tipo ? "Sector: " + tipoRaw : ""].filter(Boolean).join("\n");
  return { empresa: g("empresa"), contacto: g("contacto"), cargo: g("cargo"), tel: g("tel"), email: g("email"), cif: g("cif"), pais, provincia: g("provincia"), ciudad: g("ciudad"), web: /^https?:|^www\./i.test(g("web")) ? g("web") : "",
    tipo, linea: fuzzy(g("linea"), S.L.LINES), origen: fuzzy(g("origen"), S.L.ORIGINS), valor, potencial: fuzzy(g("potencial"), S.L.POTENTIAL), notas,
    ...(() => { const a = fuzzy(g("accion"), S.L.ACTIONS), f = impDate(g("accionFecha")); return a && f ? { accion: a, accionFecha: f } : a ? { accion: a, accionFecha: todayS() } : {}; })() };
}
function localDupes(r) {
  const out = [], pk = phoneKey(r.tel), eks = emailKeys(r.email), ck = cifKey(r.cif), nk = nameKey(r.empresa);
  for (const l of S.leads) {
    const why = [];
    if (ck.length >= 5 && cifKey(l.cif) === ck) why.push("CIF");
    if (nk.length >= 4 && nameKey(l.empresa) === nk) why.push("nombre");
    for (const c of l.contacts) { if (pk && phoneKey(c.tel) === pk && !why.includes("teléfono")) why.push("teléfono"); if (eks.length && emailKeys(c.email).some(e => eks.includes(e)) && !why.includes("email")) why.push("email"); }
    if (why.length) out.push(`${l.empresa} (${why.join(", ")})`);
  }
  return out.slice(0, 2);
}

/* =================== arranque =================== */
if (tok.get()) { showApp(); refresh(); } else showLogin();
window.__CRM = S; // para pruebas
})();
