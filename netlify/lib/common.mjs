// Código compartido por las funciones de Netlify: Airtable, sesiones, permisos y listas del CRM.
// Basado en netlify/lib/common.mjs de CalendarioPersonal (Equipo Volta).
import crypto from "node:crypto";

export const ENV = {
  token: (process.env.AIRTABLE_TOKEN || "").trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "").trim(),
  base: (process.env.AIRTABLE_BASE_ID || "").trim(),
  secret: (process.env.SESSION_SECRET || "").trim(),
  anthropicKey: (process.env.ANTHROPIC_API_KEY || "").trim(),
  anthropicModel: (process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5").trim(),
  // Solo para pruebas en local con el Airtable simulado (dev/server.mjs). En Netlify no hace falta.
  apiUrl: (process.env.AIRTABLE_API_URL || "https://api.airtable.com").replace(/\/$/, ""),
  contentUrl: (process.env.AIRTABLE_CONTENT_URL || "https://content.airtable.com").replace(/\/$/, ""),
};

export const T = { leads: "Empresas", contacts: "Contactos", acts: "Actividades", users: "Usuarios", files: "Archivos" };

/* ---------- listas (deben coincidir con las opciones de Airtable; typecast añade las nuevas) ---------- */
export const STAGES = ["Nuevo", "Contactado", "Interesado", "No interesado", "Presupuesto enviado", "Negociación", "Ganado", "Perdido"];
// «No interesado» y «Perdido» quedan fuera del embudo abierto (no piden próxima acción ni cuentan en la cartera).
export const DEAD = ["No interesado", "Perdido"];
export const OPEN = ["Nuevo", "Contactado", "Interesado", "Presupuesto enviado", "Negociación"];
export const LOSS = ["Precio", "Competencia", "No responde", "No interesa", "Otro"];
export const ACTIONS = ["Llamar", "WhatsApp", "Email", "Visita", "Enviar presupuesto"];
export const ACT_TYPES = ["Llamada", "WhatsApp", "Email", "Visita", "Nota"];
export const RESULTS = ["Hablado", "No contesta", "Interesado", "No interesado", "Pendiente de respuesta", "Enviado", "Otro"];
export const LINES = ["Litio", "Plomo", "Ambas"];
export const COUNTRIES = ["España", "Portugal", "Otro"];
export const TYPES = ["Alquiler de maquinaria", "Vehículos de ocasión", "Distribución de baterías", "Vehículos industriales", "Rent a car",
  "Carretillas / manutención", "Flotas VTC", "Concesionario", "Taller", "Tienda / distribuidor", "Marketplace", "Particular", "Otra empresa"];
export const ORIGINS = ["Prospección comercial", "Web", "WhatsApp", "Llamada entrante", "Email", "Amazon", "Feria", "Recomendación", "Visita", "Redes sociales"];
export const POTENTIAL = ["Muy alto", "Alto", "Medio-Alto", "Medio", "Bajo"];
export const PRODUCTS = {
  Litio: ["Litio · Reparación bici", "Litio · Reparación patinete", "Litio · Reparación herramienta", "Litio · Reparación cortacésped",
    "Litio · Reparación estación de carga", "Litio · Celdas", "Litio · Batería nueva", "Litio · Tracción (carretillas/PEMP)"],
  Plomo: ["Plomo · Coche", "Plomo · Start-Stop (EFB/AGM)", "Plomo · Moto", "Plomo · Camión / industrial", "Plomo · Tracción / monobloc"],
};
export const BRANDS = ["Tudor", "Exide", "Yuasa", "Varta"];
export const LISTS = { STAGES, OPEN, LOSS, ACTIONS, ACT_TYPES, RESULTS, LINES, COUNTRIES, TYPES, ORIGINS, POTENTIAL, PRODUCTS, BRANDS };

/* ---------- respuestas y errores ---------- */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export function checkEnv() {
  const miss = ["AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "SESSION_SECRET"].filter(k => !process.env[k]);
  if (miss.length) throw new HttpError(500, "Faltan variables de entorno en Netlify: " + miss.join(", "));
}

/* ---------- Airtable ---------- */
export async function at(path, opts = {}) {
  const res = await fetch(`${ENV.apiUrl}/v0/${ENV.base}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${ENV.token}`, "content-type": "application/json", ...(opts.headers || {}) },
  });
  const txt = await res.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (res.status === 401) throw new HttpError(502, "Airtable rechaza el token (401). Revisa AIRTABLE_TOKEN en Netlify: debe ser el token completo (pat….…) y tener valor en Production.");
  if (res.status === 403 || res.status === 404) throw new HttpError(502, `Airtable ${res.status}: el token no tiene acceso a la base o AIRTABLE_BASE_ID no es correcto.`);
  if (res.status === 429) throw new HttpError(429, "Airtable está recibiendo demasiadas peticiones. Espera unos segundos y vuelve a intentarlo.");
  if (!res.ok) throw new HttpError(502, `Airtable ${res.status}: ${data?.error?.message || data?.error?.type || txt.slice(0, 200)}`);
  return data;
}
export const tbl = name => encodeURIComponent(name);
export async function listAll(table, params = {}) {
  const out = []; let offset;
  do {
    const q = new URLSearchParams({ pageSize: "100", ...params });
    if (offset) q.set("offset", offset);
    const d = await at(`${tbl(table)}?${q}`);
    out.push(...(d.records || []));
    offset = d.offset;
  } while (offset);
  return out;
}
export const getRecord = (table, id) => at(`${tbl(table)}/${encodeURIComponent(id)}`);
export const createRecord = (table, fields) => at(tbl(table), { method: "POST", body: JSON.stringify({ fields, typecast: true }) });
export const updateRecord = (table, id, fields) => at(`${tbl(table)}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ fields, typecast: true }) });
export const deleteRecord = (table, id) => at(`${tbl(table)}/${encodeURIComponent(id)}`, { method: "DELETE" });
const chunks = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
// Airtable admite como máximo 10 registros por petición.
export async function createMany(table, list) {
  const out = [];
  for (const c of chunks(list, 10)) {
    const d = await at(tbl(table), { method: "POST", body: JSON.stringify({ records: c.map(fields => ({ fields })), typecast: true }) });
    out.push(...(d.records || []));
  }
  return out;
}
export async function deleteMany(table, ids) {
  for (const c of chunks(ids, 10)) {
    const q = c.map(id => "records[]=" + encodeURIComponent(id)).join("&");
    await at(`${tbl(table)}?${q}`, { method: "DELETE" });
  }
}

/* ---------- usuarios, códigos y sesiones ---------- */
export const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
export const codeHash = code => sha256("comercial-volta:" + code);
export function userOut(r) {
  const f = r.fields || {};
  return { rid: r.id, id: String(f.Id || "").trim(), name: String(f.Nombre || "").trim(), role: f.Rol === "Administrador" ? "admin" : "sales", active: !!f.Activo, hash: f["Huella código"] || "" };
}
export async function getUsers() { return (await listAll(T.users)).map(userOut).filter(u => u.id && u.name); }

const b64u = buf => Buffer.from(buf).toString("base64url");
export function signToken(payload, days = 14) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + days * 864e5 }));
  const sig = crypto.createHmac("sha256", ENV.secret).update(body).digest("base64url");
  return body + "." + sig;
}
export function readToken(req) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [body, sig] = tok.split(".");
  if (!body || !sig) return null;
  const good = crypto.createHmac("sha256", ENV.secret).update(body).digest("base64url");
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
// Sesión = { role: "admin" | "sales", who: id del usuario, name: nombre }
export function requireAuth(req, adminOnly = false) {
  const s = readToken(req);
  if (!s) throw new HttpError(401, "Sesión caducada. Vuelve a entrar con tu código.");
  if (adminOnly && s.role !== "admin") throw new HttpError(403, "Solo el administrador puede hacer esto.");
  return s;
}
export function handler(fn) {
  return async (req, ctx) => {
    try { checkEnv(); return await fn(req, ctx); }
    catch (e) { const st = e.status || 500; if (st >= 500) console.error(e); return json({ error: e.message || "Error" }, st); }
  };
}

/* ---------- utilidades de datos ---------- */
export const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
export const oneOf = (v, list, def = null) => list.includes(v) ? v : def;
export const date = v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
export const digits = s => String(s || "").replace(/\D/g, "");
// Teléfono comparable: últimas 9 cifras (quita el prefijo +34 / +351…). Menos de 6 cifras no cuenta.
export const phoneKey = s => { const d = digits(s); return d.length >= 6 ? d.slice(-9) : ""; };
export const emailKeys = s => String(s || "").toLowerCase().split(/[\s,;/]+/).map(x => x.trim()).filter(x => /.+@.+\..+/.test(x));
export const cifKey = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const todayMadrid = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
