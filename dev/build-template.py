# Genera public/plantilla-leads.xlsx: plantilla para la importación masiva de leads.
#   python3 dev/build-template.py <listas.json> public/plantilla-leads.xlsx
# (listas.json = LISTS de netlify/lib/common.mjs, para que los desplegables coincidan con el sistema)
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter

L = json.load(open(sys.argv[1])); out = sys.argv[2]
ACC = "B5532F"; INK = "1D1F22"; SOFT = "F6E3DA"; GREY = "F3F3F2"
thin = Side(style="thin", color="DCDCD9")

# (cabecera, ancho, lista desplegable, ayuda)
COLS = [
    ("Empresa", 34, None, "Obligatorio. Nombre de la empresa o del cliente (una fila por empresa o delegación)."),
    ("Persona de contacto", 24, None, "Nombre de la persona o, si no se sabe, el cargo (p. ej. «Jefe de compras»)."),
    ("Cargo", 22, None, "Cargo o departamento de la persona de contacto."),
    ("Teléfono", 17, None, "Con o sin prefijo (+34 / +351). Se usa para detectar duplicados."),
    ("Email", 28, None, "Se usa para detectar duplicados."),
    ("CIF", 13, None, "Opcional. También detecta duplicados."),
    ("País", 11, "PAIS", "España, Portugal u Otro."),
    ("Provincia", 16, None, None),
    ("Ciudad", 18, None, None),
    ("Web", 26, None, "Ej.: www.empresa.es"),
    ("Tipo de cliente", 26, "TIPO", "Elige de la lista."),
    ("Línea", 10, "LINEA", "Litio, Plomo o Ambas."),
    ("Origen", 22, "ORIGEN", "De dónde viene el lead. Si lo dejas vacío, se usa el origen que elijas al importar."),
    ("Valor estimado (€)", 14, None, "Solo el número, sin el símbolo €."),
    ("Potencial", 12, "POT", "Muy alto, Alto, Medio-Alto, Medio o Bajo."),
    ("Próxima acción", 18, "ACC", "Recomendado: así el lead no sale en rojo. Si pones acción sin fecha, se pone hoy."),
    ("Fecha próxima acción", 14, None, "Formato dd/mm/aaaa."),
    ("Notas", 44, None, "Cualquier información útil: qué necesita, flota, marcas que usa…"),
]
LISTS = {"PAIS": L["COUNTRIES"], "TIPO": L["TYPES"], "LINEA": L["LINES"], "ORIGEN": L["ORIGINS"], "POT": L["POTENTIAL"], "ACC": L["ACTIONS"]}

wb = Workbook()
ws = wb.active; ws.title = "Leads"
ws.sheet_properties.tabColor = ACC
for i, (h, w, lst, tip) in enumerate(COLS, 1):
    c = ws.cell(row=1, column=i, value=h)
    c.font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    c.fill = PatternFill("solid", fgColor=ACC if i == 1 else INK)
    c.alignment = Alignment(vertical="center", wrap_text=True)
    c.border = Border(bottom=thin)
    if tip: c.comment = Comment(tip, "Comercial Volta"); c.comment.width = 260; c.comment.height = 80
    ws.column_dimensions[get_column_letter(i)].width = w
ws.row_dimensions[1].height = 32
ws.freeze_panes = "B2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(COLS))}1"
MAXR = 2000
for r in range(2, MAXR + 1):
    ws.cell(row=r, column=COLS.index(next(c for c in COLS if c[0] == "Valor estimado (€)")) + 1).number_format = '#,##0 "€"'
    ws.cell(row=r, column=COLS.index(next(c for c in COLS if c[0] == "Fecha próxima acción")) + 1).number_format = "dd/mm/yyyy"
    ws.cell(row=r, column=4).number_format = "@"  # teléfono como texto (no pierde el + ni los ceros)

# hoja oculta con las listas para los desplegables
ls = wb.create_sheet("Listas")
for j, (k, vals) in enumerate(LISTS.items(), 1):
    ls.cell(row=1, column=j, value=k)
    for i, v in enumerate(vals, 2): ls.cell(row=i, column=j, value=v)
ls.sheet_state = "hidden"
for j, (k, vals) in enumerate(LISTS.items(), 1):
    col = next(i for i, c in enumerate(COLS, 1) if c[2] == k)
    L_ = get_column_letter(j)
    dv = DataValidation(type="list", formula1=f"=Listas!${L_}$2:${L_}${len(vals) + 1}", allow_blank=True, showDropDown=False)
    dv.error = "Elige un valor de la lista"; dv.errorTitle = "Valor no válido"; dv.showErrorMessage = True
    dv.prompt = COLS[col - 1][3] or ""; dv.showInputMessage = bool(COLS[col - 1][3])
    ws.add_data_validation(dv)
    dv.add(f"{get_column_letter(col)}2:{get_column_letter(col)}{MAXR}")
dvd = DataValidation(type="date", operator="greaterThan", formula1="DATE(2020,1,1)", allow_blank=True)
dvd.error = "Escribe una fecha (dd/mm/aaaa)"; dvd.showErrorMessage = True
ws.add_data_validation(dvd); fc = get_column_letter(next(i for i, c in enumerate(COLS, 1) if c[0] == "Fecha próxima acción")); dvd.add(f"{fc}2:{fc}{MAXR}")

# instrucciones + ejemplo (en otra hoja, para que no se importe por error)
ins = wb.create_sheet("Instrucciones", 0)
ins.sheet_properties.tabColor = INK
ins.column_dimensions["A"].width = 4; ins.column_dimensions["B"].width = 110
rows = [
    ("Comercial Volta · Plantilla para añadir leads", "title"),
    ("Volta Baterías", "sub"),
    ("", None),
    ("Cómo usarla", "h"),
    ("1.  Ve a la hoja «Leads» (pestaña de abajo) y escribe una fila por empresa o delegación. Deja la fila 1 (los títulos) como está.", None),
    ("2.  Solo la columna «Empresa» es obligatoria. Cuanto más rellenes, mejor: el teléfono, el email y el CIF sirven para detectar duplicados.", None),
    ("3.  Las columnas con flecha (País, Tipo de cliente, Línea, Origen, Potencial y Próxima acción) tienen lista desplegable: elige de la lista.", None),
    ("4.  Pon una «Próxima acción» con su fecha: así el lead entra listo y no aparece en rojo como «sin próxima acción».", None),
    ("5.  Guarda el archivo y súbelo en el sistema: Ajustes → Importar leads → Elegir archivo.", None),
    ("6.  Antes de importar verás una vista previa: los posibles duplicados salen marcados y puedes elegir el comercial al que se asignan.", None),
    ("", None),
    ("Ejemplo de una fila bien rellenada", "h"),
]
for i, (t, kind) in enumerate(rows, 1):
    c = ins.cell(row=i, column=2, value=t); c.alignment = Alignment(wrap_text=True, vertical="center")
    if kind == "title": c.font = Font(bold=True, size=20, color=INK)
    elif kind == "sub": c.font = Font(size=11, color="7C838C")
    elif kind == "h": c.font = Font(bold=True, size=13, color=ACC)
    else: c.font = Font(size=11, color=INK)
start = len(rows) + 1
example = ["Talleres García S.L.", "Paco García", "Jefe de taller", "+34 600 123 456", "paco@tallergarcia.es", "B12345678", "España", "Valencia", "Paterna",
           "www.tallergarcia.es", "Taller", "Plomo", "WhatsApp", 2500, "Medio", "Llamar", "28/11/2026", "Flota de 12 furgonetas; usa Varta. Pide precio AGM 70Ah."]
ex = wb.create_sheet("Ejemplo")
for i, (h, w, *_) in enumerate(COLS, 1):
    c = ex.cell(row=1, column=i, value=h); c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="7C838C")
    ex.column_dimensions[get_column_letter(i)].width = w
    v = ex.cell(row=2, column=i, value=example[i - 1]); v.fill = PatternFill("solid", fgColor=GREY)
ex.sheet_properties.tabColor = "7C838C"
c = ins.cell(row=start, column=2, value="Mira la hoja «Ejemplo». No la uses para importar: los datos son inventados.")
c.font = Font(size=11, italic=True, color="7C838C")
c = ins.cell(row=start + 2, column=2, value="Valores válidos")
c.font = Font(bold=True, size=13, color=ACC)
r = start + 3
for name, k in [("Tipo de cliente", "TIPO"), ("Línea", "LINEA"), ("Origen", "ORIGEN"), ("Potencial", "POT"), ("Próxima acción", "ACC"), ("País", "PAIS")]:
    c = ins.cell(row=r, column=2, value=f"{name}:  " + "  ·  ".join(LISTS[k])); c.alignment = Alignment(wrap_text=True); c.font = Font(size=10.5, color="4A4F57"); r += 1
ins.cell(row=1, column=1).fill = PatternFill("solid", fgColor=ACC)
wb.active = 1  # se abre en la hoja «Leads»
ins.sheet_view.tabSelected = False; ws.sheet_view.tabSelected = True
wb.save(out)
print("ok", out)
