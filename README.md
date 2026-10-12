# CASA · Compras compartidas (2.6)

Una app móvil de gastos del supermercado para dos personas, con Supabase (login + base de datos privada) y GitHub Pages. **Esta fase NO utiliza OpenAI ni cobra API.**

## Interfaz de CASA 2.0

- **Inicio:** presupuesto, gasto y saldo del mes actual, recomendación para lo que queda de la semana y barra del porcentaje de presupuesto disponible.
- **Historial:** filtro de mes o todos los meses, supermercado y búsqueda por supermercado o productos registrados. Detalles, edición atómica y eliminación con confirmación.
- **Data:** Resumen, Tiendas y Productos comparten mes y año. Indicadores, gasto por tienda y producto, y evolución mensual/semanal real. Las compras sin productos detallados no se asignan a productos ni categorías inventadas.
- **Settings:** nombre del hogar, presupuesto, invitación privada, cuenta, configuración pública de Supabase y cierre de sesión.
- **Añadir (+):** compra manual desde cualquier vista. Subir recibo abre lectura privada con OpenAI y revisión humana, tras configuración manual de servidor.

La recomendación semanal divide el saldo positivo del mes entre los días restantes (incluido hoy) y lo multiplica por los días desde hoy hasta el domingo, recortados al final del mes. Usa días de calendario locales, semanas lunes-domingo e importes en céntimos. Un saldo negativo se muestra como tal y recomienda cero. No arrastra presupuesto ni gastos de otros meses.

Las vistas comparten una carga paginada de las compras y sus productos. Cambiar de pestaña o filtrar no hace consultas nuevas. Registrar o eliminar una compra actualiza los datos compartidos; **Actualizar** permite consultar cambios de otra persona. Un error de carga no se representa como gasto cero. La Fase 2 requiere una migración aditiva manual; conserva los datos y las políticas RLS existentes.

## Pruebas de desarrollo

Ejecuta `node --test` desde la raíz para las pruebas de calendario, importes, filtros, paginación, autenticación, configuración y caché. Para comprobar cambios de hora locales: `TZ=Europe/Amsterdam node --test`.

Con Playwright y Chromium disponibles en el entorno, ejecuta `node scripts/check-ui.cjs`. Puedes indicar la ruta de Chromium con `CHROMIUM_PATH`. La prueba sirve los archivos en un servidor local temporal y utiliza exclusivamente Supabase simulado, incluidos registros y eliminaciones; no toca las compras reales. Comprueba móvil, escritorio, compras vacías, muchas compras, saldo negativo y caché PWA. Las capturas con datos simulados se guardan en `/tmp/casa2-mobile.png` y `/tmp/casa2-desktop.png`.

## Paso 1: Supabase

1. Abre exclusivamente el proyecto CASA Budget en https://supabase.com/dashboard. No utilices KB WODS ni otro proyecto.
2. Para una instalación nueva y vacía, ejecuta `schema.sql` una sola vez. En CASA Budget existente, no lo vuelvas a ejecutar: sigue [la migración de Fase 2](migrations/README.md).
3. En **Authentication > Providers > Email** activa email/password. Puedes dejar la confirmación por email activada; si lo haces, comprueba tus correos.
4. En **Project Settings > API** (o **Connect / API Keys**, según la interfaz), copia la **Project URL** y la clave pública **sb_publishable_...**. **No uses service_role, secret keys ni claves de OpenAI.**

## Paso 2: conectar la app

Edita `config.js` así:

```js
window.CASA_CONFIG = {
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU_CLAVE_PUBLICA'
};
```

Las claves públicas de Supabase están diseñadas para aparecer en el navegador **solo con Row Level Security configurado**. No publiques contraseñas ni secretos.

También puedes dejar `config.js` sin rellenar: al abrir la app te pedirá ambos datos y los guardará en el navegador local de ese dispositivo. Para un despliegue compartido entre dos móviles, configúralos en el archivo.

## Paso 3: publicar en GitHub Pages

1. Crea un nuevo repositorio, por ejemplo `casa-compras`, y sube los archivos de esta carpeta a la raíz del repositorio.
2. En **Settings > Pages**, selecciona **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Abre la URL de Pages. Necesita HTTPS para instalarse cómodamente como app.
4. Primera persona: crear cuenta > confirmar email si aplica > crear hogar > configurar presupuesto.
5. En **Compartir hogar y configuración** copia el código de invitación y pásalo en privado a la segunda persona.
6. Segunda persona: crear cuenta e iniciar sesión > **Unirme al hogar** > pegar código.

## Qué funciona

- Dos usuarios con emails independientes y un hogar compartido.
- Presupuesto mensual fijo, saldo restante y barra de progreso.
- Añadir compra con fecha, supermercado, total y líneas de productos opcionales.
- Historial por mes, detalle y eliminación de compras.
- Informes de gasto por supermercado y nombres de productos registrados.
- Interfaz móvil y manifiesto PWA para instalar en pantalla de inicio.
- RLS para que cuentas de otros hogares no vean los datos.

## Limitaciones de esta primera versión

- **No está conectado GPT.** Fotos de tickets, extracción automática, categorías inteligentes y chat se añadirán en una siguiente fase con Supabase Edge Functions, límites de consumo y clave de API solo en el servidor.
- La suma del gasto por producto solo incluye compras con líneas detalladas. La identidad del producto solo normaliza espacios y mayúsculas; no combina marcas, tamaños ni acentos diferentes.
- El presupuesto es el mismo para todos los meses, incluidos los pasados.
- Crear/editar compras y productos se hace en una transacción con idempotencia y control de revisión. La Fase 2 utiliza una RPC transaccional; véase `migrations/README.md`.
- El icono es SVG: instalación y visualización pueden variar según navegador. Las estadísticas no se actualizan en vivo sin recargar; ambos usuarios ven el estado actual al abrir o cambiar de mes.
- Por seguridad, el código de invitación debe compartirse solo con la pareja; cualquier usuario autenticado que posea ese código puede unirse.
- El presupuesto y las compras se sincronizan en Supabase; la app web requiere conexión a internet para cargar los datos.

## Seguridad

No pongas claves secretas en `config.js` ni en repositorios. RLS debe estar habilitado **antes** de introducir gastos personales. En Supabase comprueba que el usuario `anon` no puede leer registros y que cada usuario autenticado solo puede leer su hogar. Esta primera versión no guarda fotografías de recibos.


## Fase 2

- Editar una compra desde su detalle; conserva su ID y autor. Las líneas detalladas deben sumar el total.
- Pulsar un producto de Data para consultar su historial paginado completo; inicia con el mes de Data y ofrece **Todo**.
- Posibles duplicados (supermercado, fecha, total) requieren Cancelar o Guardar igualmente. La comprobación es una advertencia, no una restricción de unicidad.
- Una respuesta de conexión perdida mantiene la operación pendiente en este navegador, separada por usuario/hogar. Reintentar usa la misma UUID y datos; no se debe comenzar otra compra hasta resolverla. El servidor reconoce esa UUID aunque se reinicie la PWA. No borrar el almacenamiento del navegador durante un guardado pendiente.
- La migración se aplica manualmente: instrucciones en [migrations/README.md](migrations/README.md). No se ejecuta al iniciar CASA.

Pruebas: `TZ=Europe/Amsterdam node --test`, `node scripts/check-ui.cjs` (Playwright + Chromium; Supabase simulado) y `node scripts/check-sql.cjs` (Docker + PostgreSQL 17 desechable; pruebas reales de SQL, sin Supabase remoto).


## Framework 2.5

Encabezado compacto con icono provisional, CASA y botón accesible de actualización. Para corregir una conexión que impida entrar, la pantalla de autenticación conserva un acceso auxiliar a configuración. El mensaje de actualización exitosa se anuncia a lectores de pantalla; los errores permanecen visibles. Inicio contiene solo saldo/presupuesto y recomendación semanal. Las compras se consultan en Historial, y el código privado de invitación solo se muestra en Settings.

La barra representa presupuesto disponible: verde por encima del 60%, naranja por encima del 30% hasta el 60%, rojo del 0% al 30%. Se limita entre 0% y 100%; saldo negativo y presupuesto cero muestran barra vacía y estado rojo. El presupuesto cero incluye una explicación. La transición respeta movimiento reducido. No requiere cambios de base de datos.


## CASA 3.0 — Data Intelligence

- **Resumen:** gasto del mes, compras distintas, ticket promedio y presupuesto utilizado sin limitarlo al 100%. Sin compras, el ticket muestra «Sin compras»; con presupuesto cero, el porcentaje muestra «No aplicable». Los meses históricos se comparan expresamente con el presupuesto vigente, porque CASA no almacena presupuestos históricos.
- **Evolución mensual:** seis meses consecutivos terminando en el mes elegido, con ceros cuando no hay compras. **Semanal:** semanas lunes–domingo que intersectan ese mes; solo se suma gasto perteneciente al mes elegido, incluso cuando una semana cruza meses o años. No utiliza la recomendación semanal de Inicio.
- **Tiendas:** gasto y porcentaje del mes, orden descendente. Se agrupan solo espacios exteriores y mayúsculas, sin modificar nombres en Supabase. Al pulsar una tienda se muestran sus compras y acceso al detalle existente.
- **Productos:** gasto registrado y número de compras distintas. Varias líneas del mismo producto en un recibo suman sus importes y cuentan una compra. La identidad conserva acentos, marcas y tamaños; la búsqueda puede ignorar acentos sin fusionar identidades. El historial existente permite consultar el mes seleccionado o Todo.
- Los períodos incluyen meses vacíos entre el primer registro y el mes actual, al menos los seis recientes, y conservan el período elegido manualmente. Las listas muestran 50 entradas y permiten ampliar sin volver a consultar.
- Las agregaciones se reutilizan mientras no cambien período, compras, líneas o presupuesto. Cambiar pestaña, buscar o seleccionar tienda no consulta Supabase. Actualizar preserva pestaña, búsqueda y período; el cambio de sesión limpia el análisis y los filtros. Los avisos de posible desactualización permanecen visibles.

No requiere SQL ni cambios en RLS, configuración, autenticación o RPC de escritura. Las pruebas de navegador usan fixtures y bloquean las conexiones a Supabase. Las pruebas de SQL, si se ejecutan, utilizan PostgreSQL desechable y no el proyecto real.

## CASA 3.0 — Recibos inteligentes

JPEG/PNG/WebP o PDF seguro de una página → Storage privado → Edge Function → extracción estructurada → revisión editable → confirmación transaccional. Nunca se guarda automáticamente. Descuentos y ajustes se registran aparte; 81,83 − 34,95 = 46,88 €. Data conserva importes de productos, distingue ajustes atribuibles y explica promociones generales. Settings permite limpieza manual de imágenes sin borrar compras.

**Activación necesaria:** [guía paso a paso Supabase/OpenAI/Android](docs/CASA-3.0-SETUP.md). Incluye respaldo y migración independiente; esta rama no ejecuta SQL ni despliega funciones. No requiere ni admite claves OpenAI en config.js. Si falta el servidor nuevo, las compras manuales existentes siguen disponibles.

Pruebas: `node --test`, `node scripts/check-ui.cjs`, `node scripts/check-sql.cjs`. Node requiere `pdf-lib` para pruebas PDF; Playwright/Chromium para interfaz; Docker/PostgreSQL 17 para SQL aislado. Las pruebas usan mocks, claves sintéticas y bases desechables. No consumen OpenAI ni consultan Supabase real. Los nombres del fixture Jumbo son sintéticos; sus importes reproducen el caso solicitado. Validar el recibo original y Android real antes de activar.

`node scripts/build-icons.cjs` regenera PNG 192/512 desde el SVG provisional existente. Manifest y caché v13 incluyen ambos PNG y los módulos de recibos; el shell se actualiza como conjunto completo.

La revisión de recibos usa productos compactos desplegables. La extracción distingue unidades explícitas/propuestas/inciertas y ajustes contables de información ya incluida o posterior al total. El resultado antiguo sigue siendo legible; no hay migración SQL nueva. El botón **Volver a cargar módulo** recupera una carga fallida sin enviar imágenes. Consultar en la [guía de activación](docs/CASA-3.0-SETUP.md) el nuevo esquema de extracción, los límites pendientes y el pin del workflow de despliegue.

## CASA 3.1 — Revisión de recibos simplificada

- **Añadir recibo:** «Seleccionar y analizar recibo» o «Tomar una foto» inicia el análisis habitual al seleccionar el archivo. Se indica antes que se enviará a OpenAI; seleccionar no guarda una compra. Los formatos y límites anteriores siguen vigentes.
- **Revisión:** supermercado, fecha escrita con mes y año, número de productos, total pagado y descuento aplicado. Los productos siguen compactos y desplegables mediante teclado o pulsación; las propuestas e incertidumbres conservan el aviso naranja «Revisar».
- **Opciones avanzadas:** cerradas inicialmente cuando sus campos son válidos. Reúnen edición de supermercado/fecha/total, ajustes compactos, atribuciones, información secundaria y acceso al original. Los avisos obligatorios permanecen fuera; un botón abre y enfoca el campo pendiente. La validación nativa también abre los campos ocultos que necesitan corrección.
- **Confirmación:** casilla «He revisado los productos y el total pagado», guardado y cancelación en un pie separado del área desplazable. Se reserva espacio para ese pie y el área segura; la altura se adapta al viewport visual. La casilla no sustituye la validación: los datos inválidos mantienen el guardado bloqueado. Desde CASA 3.2, una diferencia de sumas es solo informativa.
- **Recuperación:** «Consultar estado / reintentar» conserva el flujo existente. Recuperar un resultado almacenado no vuelve a extraerlo. Los guardados pendientes conservan el identificador de operación y no crean otra compra al reintentar. Tras abrir de nuevo se limpia la selección de archivo para poder elegir el mismo recibo sin depender de un cambio de nombre.

Caché del shell: `casa-shell-v13-supermarket-names`, instalada como conjunto completo. El identificador de recuperación del módulo compartido sigue siendo `v10`, ya que su API no ha cambiado. El despliegue de la Edge Function, el modelo/prompt y la autenticación permanecen sin cambios. El contrato SQL de CASA 3.2 se describe a continuación.

Pruebas de CASA 3.1: `npm test`, `npm run test:ui` y `npm run test:sql`. La interfaz comprueba PNG/JPG/WebP, PDF compatible y selección de cámara con archivos locales; el servidor, Storage y OpenAI se simulan. Incluye el fixture Jumbo (81,83 − 34,95 = 46,88 €, con 0,45 € informativos), recuperación sin extracción adicional, avisos avanzados, edición, idempotencia, errores, teclado, cuatro tamaños de escritorio/móvil y viewport reducido. SQL se prueba únicamente en PostgreSQL 17 desechable con identidades de prueba. No equivalen a una prueba en producción.

Pendiente de validación manual: cámara física, teclado y áreas seguras en Android/iOS, lectores de pantalla reales y análisis de documentos reales. Las pruebas automatizadas no llaman a OpenAI ni a Supabase real. Para recibir el nuevo shell en una PWA instalada, abrir con conexión y volver a abrir/recargar; una pestaña ya abierta conserva su interfaz hasta recargarse.


## CASA 3.2 — Total pagado independiente del desglose

El total pagado impreso y confirmado por la persona es el valor definitivo de `purchases.total`. El presupuesto, Historial, Data → Resumen y Tiendas ya se basan en él. Un recibo de 28,98 € con líneas y ajustes por 31,57 € se guarda por 28,98 €, conservando las líneas originales y sin inventar un ajuste de 2,59 €.

La revisión mantiene el formato compacto. «Guardar compra · €28,98» muestra el importe que se descontará; la confirmación humana es obligatoria también al editar. Cambiar el total desmarca la confirmación, incluso si luego se vuelve al importe anterior. Reabrir un guardado pendiente restaura su confirmación, UUID y payload originales para consultar/reintentar la misma operación. Totales ausentes/no positivos/inválidos, cantidades desconocidas y campos o ajustes inválidos siguen bloqueados; las cantidades propuestas conservan «Revisar» hasta su confirmación. La suma y diferencia diagnósticas quedan solo en Opciones avanzadas, sin alarma ni bloqueo por diferencias.

Productos e historial muestran importes registrados de las líneas, que pueden preceder a descuentos generales y no sumar el gasto pagado. No se prorratean descuentos generales ni se recalculan precios. La extracción, el prompt, los importes informativos y los descuentos reales se conservan.

**Migración manual necesaria:** [`migrations/20261012_paid_total.sql`](migrations/20261012_paid_total.sql). Consultar [aplicación segura y comprobaciones](docs/CASA-3.2-PAID-TOTAL.md). Reemplaza las dos RPC de guardado con las mismas firmas y permisos, conserva el contrato de igualdad de compras manuales y no cambia tablas, RLS ni datos históricos. No volver a ejecutar la migración antigua de CASA 3.0 después de esta: reemplazaría las funciones nuevas. Si el servidor todavía rechaza la igualdad, la interfaz indica que falta aplicar CASA 3.2 y conserva el recibo pendiente.

Pruebas: `npm test`, `npm run test:ui`, `npm run test:sql`. Incluyen el nuevo ejemplo, Jumbo, confirmación al cambiar el total, reintentos, pantallas compartidas y PostgreSQL 17 aislado con migración repetida, datos históricos y permisos intactos. No llaman a Supabase/OpenAI reales. La caché es `casa-shell-v13-supermarket-names`; una PWA abierta debe recargarse para recibir la interfaz instalada nueva sin perder revisiones pendientes.

## Nombres uniformes de supermercados

Los nuevos guardados y ediciones, tanto manuales como desde recibos, convierten nombres de cadena reconocibles en `Jumbo` o `Albert Heijn` (incluido `AH`). La comparación ignora mayúsculas y espacios para reconocer la cadena al principio del campo, también tras «Supermarkt» o «Supermercado», con una separación completa; no confunde `AHOY`, `Jumboree` ni tiendas desconocidas que mencionen esas palabras. Otros nombres conservan su escritura. El campo sigue siendo editable para corregir la tienda antes de guardar.

La normalización solo recibe el supermercado, nunca los nombres de productos. No altera precios, cantidades, descuentos, presupuesto ni el JSON/archivo original del recibo. No requiere SQL, cambios de OpenAI ni reescritura del historial. Los duplicados se comparan reconociendo variantes antiguas, sin modificar esas filas. Las operaciones ya pendientes conservan su UUID y payload original, incluso si el nombre antiguo no es canónico.

Caché activa: `casa-shell-v13-supermarket-names`. Pruebas: `npm test` y `npm run test:ui`, con Supabase/OpenAI simulados, incluyendo ambas rutas, corrección manual, tiendas desconocidas, productos intactos, recuperación de operaciones anteriores y duplicados por variantes de cadena.
