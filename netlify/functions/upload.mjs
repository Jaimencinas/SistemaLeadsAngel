// POST {filename, contentType, data(base64)} -> sube el archivo a Airtable (tabla Archivos) y devuelve su url.
import { handler, json, HttpError, requireAuth, createRecord, ENV, T } from "../lib/common.mjs";

const MAX = 4 * 1024 * 1024; // límite de Netlify Functions (~6 MB por petición en base64)

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
  requireAuth(req);
  const { filename, contentType, data } = await req.json().catch(() => ({}));
  if (!data || !filename) throw new HttpError(400, "Falta el archivo");
  const bytes = Math.floor(String(data).length * 3 / 4);
  if (bytes > MAX) throw new HttpError(413, "El archivo supera 4 MB.");
  const rec = await createRecord(T.files, { Nombre: String(filename).slice(0, 200) });
  const res = await fetch(`${ENV.contentUrl}/v0/${ENV.base}/${rec.id}/${encodeURIComponent("Archivo")}/uploadAttachment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ENV.token}`, "content-type": "application/json" },
    body: JSON.stringify({ contentType: contentType || "application/octet-stream", file: data, filename: String(filename) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, "Airtable no aceptó el archivo: " + (out?.error?.message || res.status));
  const list = Object.values(out.fields || {}).find(v => Array.isArray(v)) || [];
  const a = list[list.length - 1];
  if (!a) throw new HttpError(502, "Airtable no devolvió el archivo subido");
  return json({ id: a.id, url: a.url, name: a.filename || filename, contentType: a.type || contentType || "", size: a.size || bytes });
});
