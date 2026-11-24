# Genera ComercialVolta-demo.html: la web completa + un backend simulado en el navegador, con los prospectos del Excel.
import json, sys, random, datetime as D
leads_src, lists_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
L = json.load(open(lists_path)); src = json.load(open(leads_src))
random.seed(7); today = D.date.today()
def iso(d): return d.isoformat()
leads = []
for i, o in enumerate(src):
    lid = f"recDEMO{i:010d}"
    c = o['contacto']
    tel = str(c['tel'] or '')
    if '00 00 00' in tel or '000 00 00' in tel or not any(ch.isdigit() for ch in tel): tel = ''
    leads.append(dict(id=lid, empresa=o['empresa'], grupo='', pais=o['pais'], provincia='', ciudad=o['ciudad'] or '', web=o['web'] or '', cif='',
        tipo=o['tipo'], linea=o['linea'], origen='Prospección comercial', productos=[], marcas=[], potencial=o['pot'] or '', valor=o['valor'] or 0, prob=None,
        estado='Nuevo', etapaMax='Nuevo', motivo='', motivoDetalle='', accion='', accionFecha=None, accionNota='', comercial='Ángel', notas=o['notas'],
        adjuntos=[], alta=(D.datetime.combine(today - D.timedelta(days=20), D.time(9))).isoformat()+'Z', primerContacto=None, cierre=None, ref=o['ref'],
        holdedId='', kommoId='', clickup='',
        contacts=[dict(id=lid+'c', lead=lid, nombre=c['nombre'] or 'Contacto', cargo=c['cargo'] or '', area='', tel=tel, email=c['email'] or '', principal=True)], acts=[]))
# movimientos inventados para que se vea el embudo
demo = [(2,'Contactado','Llamar',-2,'Volver a llamar a compras'),(5,'Interesado','Enviar presupuesto',0,'Presupuesto AGM para flota'),
        (20,'Presupuesto enviado','Llamar',3,'Confirmar si han recibido el presupuesto'),(12,'Negociación','Visita',5,'Visita a Sintra'),
        (24,'Contactado','Email',1,'Enviar catálogo de plomo'),(46,'Interesado',None,None,None),(33,'Ganado',None,None,None),(60,'Perdido',None,None,None),
        (19,'Contactado','WhatsApp',0,'Mandar fotos de la batería de tracción'),(57,'Presupuesto enviado','Llamar',-1,'Seguimiento presupuesto')]
order = L['STAGES']
for i, est, acc, dd, nota in demo:
    l = leads[i]; l['estado'] = est; l['etapaMax'] = 'Interesado' if est == 'Perdido' else est
    pc = D.datetime.combine(today - D.timedelta(days=15 - i % 7), D.time(10, 30)); l['primerContacto'] = pc.isoformat()+'Z'
    l['acts'].append(dict(id=l['id']+'a1', lead=l['id'], tipo='Llamada', fecha=pc.isoformat()+'Z', resultado='Hablado', texto='Primera llamada de presentación de Volta Baterías. (Actividad de demostración)', contacto=l['contacts'][0]['nombre'], comercial='Ángel', origen='Manual', resumen='Llamada · Hablado'))
    if est in ('Ganado','Perdido'): l['cierre'] = iso(today - D.timedelta(days=3))
    if est == 'Perdido': l['motivo'] = 'Precio'; l['motivoDetalle'] = 'Se queda con su proveedor actual'
    if acc: l['accion'] = acc; l['accionFecha'] = iso(today + D.timedelta(days=dd)); l['accionNota'] = nota
seed = dict(leads=leads, users=[dict(rid='recUSERadmin00001', id='admin', name='Jaime', role='admin', active=True, code='111111'),
                                dict(rid='recUSERangel00001', id='angel', name='Ángel', role='sales', active=True, code='222222')])
html = open('public/index.html').read(); app = open('public/app.js').read(); mock = open('dev/demo-mock.js').read()
banner = '''<div style="background:#1d1f22;color:#fff;font:13px 'IBM Plex Sans',sans-serif;padding:7px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
<b style="color:#f6c9b5">MODO DEMOSTRACIÓN</b><span>Tus 68 prospectos del Excel con algunos movimientos inventados. Los cambios solo se guardan en este navegador; no toca Airtable.</span>
<span style="margin-left:auto">Códigos: <b>111111</b> Jaime (admin) · <b>222222</b> Ángel</span><button onclick="__resetDemo()" style="background:#fff;color:#1d1f22;border:0;border-radius:6px;padding:3px 10px;cursor:pointer;font-weight:600">Reiniciar demo</button></div>'''
scripts = ("<script>window.__DEMO_LISTS=" + json.dumps(L, ensure_ascii=False) + ";window.__DEMO_SEED=" + json.dumps(seed, ensure_ascii=False) + ";</script>\n<script>" + mock + "</script>\n<script>" + app + "</script>")
assert '<script src="app.js"></script>' in html
html = html.replace('<script src="app.js"></script>', scripts.replace('</script>\n<script>', '</script>\n<script>'))
html = html.replace('<body>\n', '<body>\n' + banner + '\n', 1).replace('<title>Comercial Volta · Leads</title>', '<title>Comercial Volta · DEMO</title>')
open(out, 'w').write(html); print(len(html), 'bytes')
