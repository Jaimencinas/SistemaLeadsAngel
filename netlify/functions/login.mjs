// POST {code} -> {token, role, who, name}
import { handler, json, HttpError, getUsers, codeHash, signToken } from "../lib/common.mjs";

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
  const { code } = await req.json().catch(() => ({}));
  if (!/^\d{6}$/.test(String(code || ""))) throw new HttpError(400, "El código tiene 6 dígitos.");
  const users = (await getUsers()).filter(u => u.active && u.hash);
  if (!users.length) throw new HttpError(400, "Todavía no hay códigos configurados (tabla Usuarios de Airtable).");
  const h = codeHash(String(code));
  const u = users.find(x => x.hash === h);
  if (!u) { await new Promise(r => setTimeout(r, 900)); throw new HttpError(401, "Código incorrecto."); }
  const session = { role: u.role, who: u.id, name: u.name };
  return json({ token: signToken(session), ...session });
});
