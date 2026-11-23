# Comercial Volta · Gestión de leads

CRM sencillo para el comercial de Volta Baterías (líneas **Litio** y **Plomo**). Usa la misma arquitectura e identidad visual que el calendario **Equipo Volta** (`Jaimencinas/CalendarioPersonal`).

- **Hosting:** Netlify.
- **Base de datos:** Airtable, base **«Comercial Volta · Leads»**.

## Qué hace (versión 1)

- **Hoy:** pantalla de inicio del comercial. Muestra, por orden de urgencia:
  - acciones vencidas;
  - acciones de hoy;
  - leads sin próxima acción (en rojo);
  - leads nuevos sin contactar;
  - lo programado para los próximos 7 días.
- **Embudo (Kanban):** columnas Nuevo → Contactado → Interesado → Presupuesto enviado → Negociación → Ganado / Perdido.
  - Las tarjetas se arrastran para cambiar de estado.
  - Al soltar en «Perdido» pide el motivo.
  - Filtros: línea, tipo de cliente, origen, provincia/ciudad y búsqueda de texto.
- **Lista:**
  - Los mismos filtros, ordenables por columnas.
  - Exportación a **Excel (CSV)** y **PDF de la cartera**.
  - El administrador puede marcar varios leads y reasignarlos.
- **Ficha del lead:**
  - Datos, clasificación, productos de interés (cambian según la línea), marcas, valor y probabilidad.
  - Varios contactos por empresa, notas, adjuntos y comercial asignado.
- **Seguimiento:**
  - Próxima acción obligatoria con fecha; si falta, sale en rojo.
  - Historial de llamadas, WhatsApp, emails, visitas y notas.
  - Botones de llamar, WhatsApp y email.
  - **🎤 Dictar** y **✨ Ordenar con IA**: limpia la nota, elige el resultado y propone la próxima acción.
- **Alta rápida** (botón «＋ Nuevo lead»):
  - Pocos campos e Intro para guardar.
  - Avisa de duplicados por teléfono, email, CIF o nombre.
- **Resultados:**
  - Embudo con la conversión por etapa.
  - Cartera abierta por línea y por etapa.
  - Ganados y perdidos del periodo, y motivos de pérdida.
  - Leads por origen y tiempo medio hasta el primer contacto.
- **Ajustes** (solo administrador):
  - Códigos de acceso y alta de comerciales.
  - **Importar leads** desde CSV o Excel, con elección de columnas, vista previa y detección de duplicados.

### Permisos (se comprueban en el servidor)

- **Comercial:**
  - Solo recibe sus propios leads.
  - Puede crearlos, editarlos y registrar actividades en ellos.
- **Administrador:**
  - Ve todos los leads.
  - Reasigna, borra, importa y cambia los códigos.
- El token de Airtable nunca llega al navegador.

## Estructura

```
public/index.html              La web (estilos y estructura)
public/app.js                  Toda la lógica de la página (sin frameworks)
netlify/functions/login.mjs    Comprueba el código de 6 dígitos y abre la sesión firmada
netlify/functions/api.mjs      Leads, contactos, actividades, duplicados, importación y usuarios
netlify/functions/upload.mjs   Sube adjuntos a Airtable (máx. 4 MB)
netlify/functions/ai.mjs       IA opcional con la API de Claude
netlify/lib/common.mjs         Código compartido (Airtable, sesiones, listas)
dev/server.mjs                 Servidor de pruebas con un Airtable simulado (no toca datos reales)
dev/test.mjs                   Prueba automática en navegador
```

## Desplegar en Netlify (una sola vez)

1. En Netlify, entra en **Add new site → Import an existing project → GitHub** y elige `Jaimencinas/ComercialVolta`. No hay que tocar la compilación, porque `netlify.toml` ya lo indica todo.
2. En **Site configuration → Environment variables**, añade estas variables y márcalas como **secretas**:

   | Variable | Valor |
   |---|---|
   | `AIRTABLE_TOKEN` | Token personal de Airtable (ver abajo) |
   | `AIRTABLE_BASE_ID` | `appeqmeuX4vlQUpuK` (la base «Comercial Volta · Leads») |
   | `SESSION_SECRET` | Una frase larga y aleatoria, de al menos 40 caracteres |
   | `ANTHROPIC_API_KEY` | *(Opcional)* Clave de la API de Claude para «Ordenar con IA» |

   Si quieres otro modelo, puedes añadir también `ANTHROPIC_MODEL` (opcional, por defecto `claude-sonnet-5-5`).
3. Ve a **Deploys → Trigger deploy**. Al terminar, abre la URL del sitio y entra con tu código.

### Token de Airtable

Créalo en airtable.com/create/tokens:

- **Permisos (scopes):** `data.records:read` y `data.records:write`.
- **Acceso:** la base **«Comercial Volta · Leads»**.

Puede ser el mismo token del calendario si le añades acceso a esta base.

## Códigos de acceso

- Están en la tabla **Usuarios** de Airtable, guardados como huellas cifradas.
- Se cambian desde la web, en **Ajustes → Usuarios y códigos**, con el código de administrador.
- Para añadir un comercial: **Ajustes → Añadir comercial**. Después se le asignan leads desde su ficha o con «Reasignar» en la Lista.

## Tablas de Airtable

- **Empresas:** un lead por empresa o delegación.
  - Datos y clasificación: estado, próxima acción, comercial, valor, etc.
  - Campos automáticos: «Fecha alta», «Primer contacto», «Fecha cierre» y «Etapa máxima», que sirve para calcular la conversión del embudo.
- **Contactos:** las personas de cada empresa, enlazadas a Empresas.
- **Actividades:** el historial. Incluye los cambios de estado, que se registran solos.
- **Usuarios:** quién puede entrar y con qué rol.
- **Archivos:** almacén temporal de las subidas; se puede vaciar de vez en cuando.

Se puede editar directamente en Airtable. La web recoge los cambios cada minuto o al recargar.

## Fases siguientes (el diseño ya está preparado)

- **Kommo (WhatsApp):**
  - Campo `Kommo ID` en Empresas.
  - Las conversaciones entrarán como Actividades con `Origen = Kommo`.
- **Holded:** campo `Holded ID`. Al pasar a «Presupuesto enviado» se creará el contacto y el presupuesto.
- **Ringover:** las llamadas entrarán como Actividades con `Origen = Ringover`.
- **ClickUp:** campo `ClickUp`, con un enlace a la tarea, como en el botón «Traer de ClickUp» del calendario.
- **Calendario Equipo Volta:** las próximas acciones están en los campos «Próxima acción» y «Fecha próxima acción», listas para mostrarse en el calendario.

## Probar en local (sin tocar Airtable)

```bash
node dev/server.mjs        # http://localhost:8888 · códigos: admin 111111 · comercial 222222
NODE_PATH=$(npm root -g) node dev/test.mjs   # prueba automática (necesita Playwright)
```

## Notas

- **Dictado:** funciona en Google Chrome y Microsoft Edge.
- **Excel:**
  - La exportación es un CSV con punto y coma, que se abre directamente en Excel.
  - Para importar archivos `.xlsx`, la web carga el lector de Excel de SheetJS solo en ese momento. Si falla, guarda el Excel como CSV e impórtalo así.
