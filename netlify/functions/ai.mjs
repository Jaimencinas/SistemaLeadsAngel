// POST {prompt} -> {text}. Usa la API de Claude con ANTHROPIC_API_KEY (opcional). Para el administrador y los comerciales.
import { handler, json, HttpError, requireAuth, ENV } from "../lib/common.mjs";

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
  requireAuth(req);
  if (!ENV.anthropicKey) throw new HttpError(501, "La IA no está configurada (falta ANTHROPIC_API_KEY en Netlify).");
  const { prompt } = await req.json().catch(() => ({}));
  if (!prompt || String(prompt).length > 30000) throw new HttpError(400, "Texto vacío o demasiado largo");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ENV.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ENV.anthropicModel, max_tokens: 1500, messages: [{ role: "user", content: String(prompt) }] }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 429 ? 429 : 502, "Claude: " + (out?.error?.message || res.status));
  const text = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
  return json({ text });
});
