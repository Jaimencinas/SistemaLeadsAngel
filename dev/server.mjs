// Servidor de pruebas en local, SIN tocar el Airtable real.
//   node dev/server.mjs        -> http://localhost:8888
// Simula: la API de Airtable (en memoria), las funciones de Netlify y la carpeta /public.
// Códigos de prueba: administrador 111111 · Ángel 222222
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8888);
const MOCK = `http://127.0.0.1:${PORT}/__airtable`;

Object.assign(process.env, {
  AIRTABLE_TOKEN: "patMOCK.local", AIRTABLE_BASE_ID: "appMOCKMOCKMOCK00", SESSION_SECRET: "secreto-solo-para-pruebas-locales",
  AIRTABLE_API_URL: MOCK, AIRTABLE_CONTENT_URL: MOCK,
});

/* ---------------- Airtable simulado ---------------- */
const rid = () => "rec" + crypto.randomBytes(10).toString("base64").replace(/[^A-Za-z0-9]/g, "").padEnd(14, "x").slice(0, 14);
const hash = c => crypto.createHash("sha256").update("comercial-volta:" + c).digest("hex");
const DB = { Empresas: [], Contactos: [], Actividades: [], Usuarios: [], Archivos: [] };
const rec = (table, fields) => { const r = { id: rid(), createdTime: new Date().toISOString(), fields: clean(fields) }; DB[table].push(r); return r; };
function clean(f) { const o = {}; for (const [k, v] of Object.entries(f || {})) if (v !== null && v !== "" && !(Array.isArray(v) && !v.length) && v !== false) o[k] = v; return o; }

function seed() {
  rec("Usuarios", { Nombre: "Jaime", Id: "admin", Rol: "Administrador", "Huella código": hash("111111"), Activo: true });
  rec("Usuarios", { Nombre: "Ángel", Id: "angel", Rol: "Comercial", "Huella código": hash("222222"), Activo: true });
  const today = new Date(); const d = n => { const x = new Date(today); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const sample = [
    ["GAM (General de Alquiler de Maquinaria)", "Alquiler de maquinaria", "Ambas", "Nuevo", 60000, "Oviedo (Asturias)", "España", "+34 900 23 00 20", "compras@gamrentals.com", null],
    ["Kiloutou España", "Alquiler de maquinaria", "Ambas", "Contactado", 40000, "Barcelona", "España", "+34 900 83 84 67", "igimenez@kiloutou.es", ["Llamar", d(-3)]],
    ["Flexicar", "Vehículos de ocasión", "Plomo", "Interesado", 75000, "Madrid", "España", "+34 911 08 08 08", "info@flexicar.es", ["Enviar presupuesto", d(0)]],
    ["Fraikin España", "Vehículos industriales", "Plomo", "Presupuesto enviado", 80000, "Barcelona", "España", "+34 932 61 61 00", "info.spain@fraikin.com", ["Email", d(2)]],
    ["Grupo Vendap", "Alquiler de maquinaria", "Ambas", "Negociación", 60000, "Sintra / Lisboa", "Portugal", "+351 212 349 900", "info@grupovendap.com", null],
    ["Bicis Eléctricas Sol", "Tienda / distribuidor", "Litio", "Ganado", 8000, "Alicante", "España", "+34 600 111 222", "hola@bicissol.es", null],
    ["Taller Paco", "Taller", "Plomo", "Perdido", 3000, "Valencia", "España", "+34 600 333 444", "", null],
    ["Linde Material Handling Ibérica", "Carretillas / manutención", "Ambas", "Nuevo", 70000, "Barcelona", "España", "+34 93 663 32 32", "info@linde-mh.es", null],
  ];
  sample.forEach(([emp, tipo, linea, estado, valor, ciudad, pais, tel, email, acc], i) => {
    const alta = new Date(today); alta.setDate(alta.getDate() - 20 + i);
    const f = { Empresa: emp, "Tipo de cliente": tipo, "Línea": linea, Estado: estado, "Valor estimado": valor, Ciudad: ciudad, "País": pais,
      Origen: i % 3 ? "Prospección comercial" : "Web", Comercial: "Ángel", "Fecha alta": alta.toISOString(), Potencial: "Alto", "Etapa máxima": estado === "Perdido" ? "Interesado" : estado };
    if (estado !== "Nuevo") { const p = new Date(alta); p.setDate(p.getDate() + 2); f["Primer contacto"] = p.toISOString(); }
    if (estado === "Ganado" || estado === "Perdido") f["Fecha cierre"] = d(-1);
    if (estado === "Perdido") f["Motivo pérdida"] = "Precio";
    if (acc) { f["Próxima acción"] = acc[0]; f["Fecha próxima acción"] = acc[1]; }
    const l = rec("Empresas", f);
    rec("Contactos", { Nombre: "Responsable de compras", Cargo: "Compras", "Teléfono": tel, Email: email, Principal: true, Empresa: [l.id] });
    if (estado !== "Nuevo") rec("Actividades", { Resumen: "Llamada · Hablado", Empresa: [l.id], Tipo: "Llamada", Resultado: "Hablado", Fecha: f["Primer contacto"], Texto: "Primera llamada de presentación.", Comercial: "Ángel", Origen: "Manual" });
  });
}
seed();

function airtable(req, res, url, body) {
  const parts = url.pathname.replace(/^\/__airtable\/v0\//, "").split("/").map(decodeURIComponent);
  // subida de adjuntos: /<base>/<recId>/<campo>/uploadAttachment
  if (parts[3] === "uploadAttachment") {
    const r = DB.Archivos.find(x => x.id === parts[1]);
    if (!r) return send(res, 404, { error: { type: "NOT_FOUND" } });
    const a = { id: "att" + crypto.randomBytes(7).toString("hex").slice(0, 14), url: `data:${body.contentType};base64,${body.file}`, filename: body.filename, type: body.contentType, size: Math.floor(body.file.length * 3 / 4) };
    r.fields.Archivo = [...(r.fields.Archivo || []), a];
    return send(res, 200, { id: r.id, fields: { [parts[2]]: r.fields.Archivo } });
  }
  if (req.headers.authorization !== "Bearer patMOCK.local") return send(res, 401, { error: { type: "AUTHENTICATION_REQUIRED" } });
  const [, table, id] = parts;
  const T = DB[table];
  if (!T) return send(res, 404, { error: { type: "TABLE_NOT_FOUND" } });
  const fixAtt = f => { if (Array.isArray(f.Adjuntos)) f.Adjuntos = f.Adjuntos.map(a => a.id ? (findAtt(a.id) || a) : { id: "att" + crypto.randomBytes(7).toString("hex").slice(0, 14), url: a.url, filename: a.filename }); return f; };
  if (req.method === "GET" && !id) {
    const size = Number(url.searchParams.get("pageSize") || 100), off = Number(url.searchParams.get("offset") || 0);
    const page = T.slice(off, off + size);
    return send(res, 200, { records: page, ...(off + size < T.length ? { offset: String(off + size) } : {}) });
  }
  if (req.method === "GET") { const r = T.find(x => x.id === id); return r ? send(res, 200, r) : send(res, 404, { error: { type: "NOT_FOUND" } }); }
  if (req.method === "POST") {
    if (Array.isArray(body.records)) { if (body.records.length > 10) return send(res, 422, { error: { type: "INVALID_RECORDS", message: "máx. 10" } }); return send(res, 200, { records: body.records.map(r => rec(table, fixAtt(r.fields))) }); }
    return send(res, 200, rec(table, fixAtt(body.fields)));
  }
  if (req.method === "PATCH") {
    const patch = (rid, fields) => { const r = T.find(x => x.id === rid); if (!r) return null; r.fields = clean({ ...r.fields, ...fixAtt(fields) }); return r; };
    if (Array.isArray(body.records)) { if (body.records.length > 10) return send(res, 422, { error: { type: "INVALID_RECORDS" } }); return send(res, 200, { records: body.records.map(r => patch(r.id, r.fields)) }); }
    const r = patch(id, body.fields); return r ? send(res, 200, r) : send(res, 404, { error: { type: "NOT_FOUND" } });
  }
  if (req.method === "DELETE") {
    const ids = id ? [id] : url.searchParams.getAll("records[]");
    if (ids.length > 10) return send(res, 422, { error: { type: "INVALID_RECORDS" } });
    for (const x of ids) { const i = T.findIndex(r => r.id === x); if (i >= 0) T.splice(i, 1); }
    return send(res, 200, { records: ids.map(x => ({ id: x, deleted: true })) });
  }
  send(res, 405, {});
}
function findAtt(id) { for (const r of DB.Archivos) for (const a of r.fields.Archivo || []) if (a.id === id) return a; for (const r of DB.Empresas) for (const a of r.fields.Adjuntos || []) if (a.id === id) return a; return null; }
function send(res, st, obj) { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); }

/* ---------------- funciones + estáticos ---------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const fnCache = {};
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  try {
    if (url.pathname.startsWith("/__airtable/")) return airtable(req, res, url, raw.length ? JSON.parse(raw.toString()) : {});
    if (url.pathname === "/__dump") return send(res, 200, DB);
    const m = url.pathname.match(/^\/\.netlify\/functions\/([a-z]+)$/);
    if (m) {
      const file = path.join(ROOT, "netlify/functions", m[1] + ".mjs");
      if (!fs.existsSync(file)) return send(res, 404, { error: "no existe" });
      const mod = fnCache[m[1]] ||= await import(pathToFileURL(file).href);
      const r = await mod.default(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : raw }), {});
      res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = path.join(ROOT, "public", decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!p.startsWith(path.join(ROOT, "public")) || !fs.existsSync(p)) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
  } catch (e) { console.error(e); send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log(`Comercial Volta (Airtable simulado) en http://localhost:${PORT}  ·  códigos: admin 111111 · Ángel 222222`));
