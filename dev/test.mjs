// Prueba de extremo a extremo en un navegador (Playwright) contra dev/server.mjs (Airtable simulado).
//   node dev/server.mjs &   y luego   NODE_PATH=... node dev/test.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const URL = process.env.URL || "http://localhost:8888";
const out = process.env.SHOTS || "/tmp/shots";
fs.mkdirSync(out, { recursive: true });

const errors = [];
const ok = (c, m) => { if (!c) { errors.push(m); console.log("✗", m); } else console.log("✓", m); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
page.on("pageerror", e => errors.push("JS: " + e.message));
page.on("console", m => { if (m.type() === "error" && !/fonts\.g|cdn\.sheetjs|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
page.on("dialog", d => d.accept());

async function login(code) {
  await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL);
  await page.fill("#codeIn", code); await page.waitForSelector("#app:not(.hidden)"); await page.waitForTimeout(400);
}

// ---------- comercial ----------
await login("222222");
ok(await page.textContent("#meName") === "Ángel", "entra Ángel con su código");
ok(await page.isHidden('[data-v="ajustes"]'), "el comercial no ve Ajustes");
ok((await page.$$(".lrow")).length > 0, "vista Hoy con filas");
await page.screenshot({ path: out + "/1-hoy.png", fullPage: true });

// alta rápida con duplicado
await page.click("#newBtn");
await page.fill("#qEmp", "Talleres García");
await page.fill("#qTel", "+34 911 08 08 08");
await page.waitForSelector(".dupbox", { timeout: 4000 });
ok(/Flexicar/.test(await page.textContent(".dupbox")), "detecta duplicado por teléfono");
await page.fill("#qTel", "600 123 456"); await page.waitForTimeout(700);
await page.fill("#qCon", "Paco García");
await page.click('#qLin button[data-val="Plomo"]');
await page.selectOption("#qTipo", "Taller");
await page.selectOption("#qOri", "WhatsApp");
await page.screenshot({ path: out + "/2-alta.png" });
await page.click("#qSave");
await page.waitForSelector(".drawer"); await page.waitForTimeout(500);
ok(/Talleres García/.test(await page.textContent(".dr-h h2")), "lead creado y abierto");

// registrar actividad con siguiente paso
await page.click('#actT button[data-v="Llamada"]');
await page.selectOption("#actR", "Interesado");
await page.fill("#actX", "Quiere 10 baterías AGM 70Ah para la flota, pide precio.");
await page.selectOption("#acAcc", "Enviar presupuesto");
await page.click('[data-dates="ac"] button[data-n="1"]');
await page.click("#actSave"); await page.waitForTimeout(900);
const st = await page.evaluate(() => { const l = __CRM.leads.find(x => x.empresa === "Talleres García"); return { e: l.estado, a: l.accion, n: l.acts.length, pc: !!l.primerContacto }; });
ok(st.e === "Contactado" && st.a === "Enviar presupuesto" && st.n >= 1 && st.pc, "actividad guarda historial, pasa a Contactado y fija próxima acción " + JSON.stringify(st));
await page.screenshot({ path: out + "/3-ficha-seguimiento.png", fullPage: true });

// ficha: añadir contacto y producto
await page.click('.dr-tabs button[data-t="ficha"]');
await page.click("#addC");
const rows = await page.$$(".ct"); const last = rows[rows.length - 1];
await (await last.$('[data-k="nombre"]')).fill("Lucía (compras)");
await (await last.$('[data-k="email"]')).fill("lucia@tallergarcia.es");
await page.click('#fProd [data-p="Plomo · Start-Stop (EFB/AGM)"]');
await page.click('#fMar [data-b="Tudor"]');
await page.fill("#fVal", "1800");
await page.click("#fSave"); await page.waitForTimeout(1200);
const f = await page.evaluate(() => { const l = __CRM.leads.find(x => x.empresa === "Talleres García"); return { c: l.contacts.length, p: l.productos, m: l.marcas, v: l.valor }; });
ok(f.c === 2 && f.p.length === 1 && f.m[0] === "Tudor" && f.v === 1800, "ficha guarda contactos, productos, marca y valor " + JSON.stringify(f));
await page.screenshot({ path: out + "/4-ficha.png", fullPage: true });
await page.click("#drX");

// kanban: arrastrar a Perdido
await page.click('[data-v="embudo"]'); await page.waitForTimeout(300);
await page.screenshot({ path: out + "/5-embudo.png" });
await page.evaluate(() => { const c = [...document.querySelectorAll(".kc")].find(x => x.textContent.includes("Talleres García")); const col = document.querySelector('.col[data-st="Perdido"]'); const dt = new DataTransfer();
  c.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt })); col.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt })); col.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt })); c.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt })); });
await page.waitForSelector("#lossT");
await page.click('#lossT button[data-v="Precio"]'); await page.click("#lossOk"); await page.waitForTimeout(900);
const lo = await page.evaluate(() => { const l = __CRM.leads.find(x => x.empresa === "Talleres García"); return { e: l.estado, m: l.motivo, c: l.cierre }; });
ok(lo.e === "Perdido" && lo.m === "Precio" && lo.c, "arrastrar a Perdido pide motivo y cierra " + JSON.stringify(lo));

// lista + exportaciones
await page.click('[data-v="lista"]'); await page.waitForTimeout(300);
await page.selectOption('[data-f="tipo"]', "Vehículos de ocasión"); await page.waitForTimeout(300);
ok((await page.$$(".tbl tbody tr")).length === 1, "filtro por tipo en la Lista");
await page.click("[data-clear]"); await page.waitForTimeout(200);
let [dl] = await Promise.all([page.waitForEvent("download"), page.click("#csvBtn")]);
const csv = fs.readFileSync(await dl.path(), "utf8");
ok(csv.startsWith("﻿Empresa;") && csv.split("\r\n").length > 3, "exporta CSV para Excel");
[dl] = await Promise.all([page.waitForEvent("download"), page.click("#pdfBtn")]);
const pdf = fs.readFileSync(await dl.path());
ok(pdf.slice(0, 5).toString() === "%PDF-", "genera PDF de cartera (" + pdf.length + " bytes)");
fs.writeFileSync(out + "/cartera.pdf", pdf);
await page.screenshot({ path: out + "/6-lista.png" });

// resultados
await page.click('[data-v="resultados"]'); await page.waitForTimeout(300);
ok((await page.$$("#v-resultados .bar-r")).length >= 6, "panel de resultados");
await page.screenshot({ path: out + "/7-resultados.png", fullPage: true });

// ---------- administrador ----------
await login("111111");
ok(await page.isVisible('[data-v="ajustes"]'), "el administrador ve Ajustes");
await page.click('[data-v="ajustes"]');
await page.fill("#nuName", "Marta"); await page.fill("#nuCode", "333333"); await page.click("#nuSave"); await page.waitForTimeout(800);
ok(await page.evaluate(() => __CRM.users.some(u => u.name === "Marta")), "añade un comercial nuevo");
// importar CSV
const csvIn = "Empresa;Contacto;Teléfono;Email;Sector;Valor\nTalleres Norte;Juan;611222333;juan@norte.es;Taller;2500\nFlexicar Bis;Ana;+34 911 08 08 08;;Concesionario;9000\n";
fs.writeFileSync("/tmp/imp.csv", csvIn);
await page.setInputFiles("#impFile", "/tmp/imp.csv"); await page.waitForSelector("#impGo");
await page.screenshot({ path: out + "/8-importar.png", fullPage: true });
ok(/1 posibles duplicados/.test(await page.textContent("#impMsg")), "vista previa detecta el duplicado");
await page.click("#impGo"); await page.waitForTimeout(1500);
const imp = await page.evaluate(() => ({ n: __CRM.leads.some(l => l.empresa === "Talleres Norte" && l.tipo === "Taller" && l.valor === 2500 && l.contacts[0]?.tel === "611222333"), d: __CRM.leads.some(l => l.empresa === "Flexicar Bis") }));
ok(imp.n && !imp.d, "importa y salta el duplicado " + JSON.stringify(imp));
// comercial nuevo solo ve lo suyo
await login("333333");
ok(await page.evaluate(() => __CRM.leads.length) === 0, "Marta no ve los leads de Ángel");

// móvil
await page.setViewportSize({ width: 390, height: 840 }); await login("222222");
await page.screenshot({ path: out + "/9-movil.png", fullPage: false });

await browser.close();
console.log(errors.length ? "\nERRORES:\n" + errors.join("\n") : "\nTodo correcto.");
process.exit(errors.length ? 1 : 0);
