# CASA 3.0: activación manual, sin tocar KB WODS

La rama contiene código; subirla no activa Storage, OpenAI ni la Edge Function. No hacer merge/desplegar la PWA hasta completar esta lista. No hay llamadas reales en las pruebas automatizadas. No copiar secretos en GitHub, config.js, chats o capturas.

## 1. Respaldo y ensayo

1. En Supabase, seleccionar **CASA Budget** y comprobar la referencia de proyecto en su URL. No seleccionar KB WODS.
2. Obtener un respaldo restaurable de esquema y datos con Supabase CLI/pg_dump, incluyendo funciones, triggers y RLS. Los cuatro CSV no respaldan funciones ni permisos. Conservar también `purchase_operations` de Fase 2: permite recuperar operaciones pendientes.
3. Restaurar primero en una base/proyecto de ensayo. Revisar recuentos y sumas. No usar datos personales en pruebas compartidas.
4. Si ya hay Storage, copiar por separado sus objetos y un manifiesto de ruta/tamaño/hash; un dump SQL no contiene archivos. Probar la restauración conjunta.
5. En el entorno de desarrollo, `node scripts/check-sql.cjs` crea PostgreSQL 17 desechable y prueba las migraciones dos veces, RLS, rollback, idempotencia y concurrencia. No reproduce Auth, PostgREST ni el servicio Storage completo.

## 2. SQL y bucket

Orden: `schema.sql` solo para una base NUEVA; `migrations/20261009_phase_2.sql` si Fase 2 no está aplicada; después **`migrations/20261010_smart_receipts.sql`**. Nunca volver a ejecutar schema.sql en el proyecto existente.

1. Abrir SQL Editor del proyecto de ensayo, revisar y ejecutar la migración 3.0 completa (BEGIN/COMMIT). Hacer lo mismo en CASA real únicamente con autorización, respaldo probado y ventana de baja actividad.
2. Comprobar tablas `purchase_receipts`, `purchase_adjustments`, `receipt_attempts`; RPC `casa_save_receipt`, `casa_receipt_begin/cancel/forget_file/claim`; trigger de revisión de ajustes.
3. Storage → bucket **receipts**: debe ser **privado**, límite **10 MB**, MIME JPEG/PNG/WebP/PDF. La migración lo crea si no existe; si ya existe, NO lo modifica silenciosamente y aborta si detecta privacidad/límites incompatibles. Verificar manualmente privacidad y límites, y corregirlos antes de activar. No reutilizar un bucket público.
4. Revisar que SOLO existan las políticas previstas para ese bucket: lectura por hogar, alta de original pendiente por su creador, borrado por miembros fuera de procesamiento. No hay UPDATE/upsert. Eliminar permisos amplios previos solo tras revisión explícita.
5. Comprobar que las nuevas tablas no tienen escrituras directas para `authenticated`/`anon`; `receipt_attempts` es inaccesible al navegador. La RPC de reserva de costes solo se concede a `service_role`.
6. Dos miembros del mismo hogar deben poder consultar un recibo. Un usuario de otro hogar y uno sin sesión no pueden leer metadatos, subir, firmar enlaces ni eliminar archivos. Probar esas acciones usando JWTs de ensayo, nunca claves administrativas en el navegador.

La migración conserva compras antiguas y sus importes. Sustituye la implementación de `casa_save_purchase` conservando su firma, petición idempotente y operaciones pendientes; impide que clientes antiguos eliminen descuentos. No purgar `purchase_operations`.

## 3. OpenAI: clave exclusivamente en servidor

1. Crear una clave de API en el proyecto OpenAI destinado a CASA. Configurar alertas y presupuesto del proveedor. No confundir ChatGPT con la facturación API.
2. Supabase → Edge Functions → Secrets: añadir **OPENAI_API_KEY** allí. No pegarla en archivos locales/versionados ni comandos de shell que la dejen en el historial.
3. Configurar secretos/variables del servidor:

| Nombre | Predeterminado | Uso |
|---|---|---|
| OPENAI_RECEIPT_MODEL | gpt-4.1-mini | Modelo; verificar disponibilidad y precios actuales |
| CASA_ORIGIN | https://jozeless.github.io | Origen permitido, sin /casa-budget/ |
| RECEIPT_MAX_BYTES | 10485760 | 1 KB–10 MB; solo bajar el límite |
| RECEIPT_DAILY_LIMIT | 40 | Intentos por hogar en ventana móvil de 24 h |
| RECEIPT_GLOBAL_DAILY_LIMIT | 200 | Intentos de todo el proyecto en 24 h |
| RECEIPT_MAX_OUTPUT_TOKENS | 6000 | 1.000–12.000 tokens de salida |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY` suelen estar disponibles en Edge Functions. La clave administrativa nunca se devuelve al navegador. Si se usa una public publishable key para las llamadas Auth/RLS, añadir `SUPABASE_PUBLISHABLE_KEY` en servidor. No solicitar secretos en chat.

Los límites de intentos se aplican en PostgreSQL con bloqueo, cuentan fallos y no dependen del navegador. Cada hogar tiene además máximo 20 recibos pendientes con archivo y 100 altas en 24 h. No existe purga automática. Revisar almacenamiento y consumo periódicamente.

## 4. Desplegar la función únicamente cuando se autorice

Desde el repositorio con Supabase CLI instalada y una sesión de administrador adecuada:

```sh
supabase functions deploy extract-receipt --project-ref REFERENCIA_CASA
```

La configuración `verify_jwt=false` permite el uso de las claves publishable actuales: **no significa acceso anónimo**. La función valida Authorization con `/auth/v1/user`, lee el recibo mediante el JWT y RLS y comprueba la pertenencia antes de usar la credencial administrativa. No activar una implementación que omita esos controles. Las importaciones compartidas y pdf-lib se empaquetan con la función.

No desplegar como parte de los tests. El modelo es una variable del servidor: cambiarlo no requiere cambiar config.js, pero sí repetir el conjunto de evaluación de recibos.

## 5. Verificación antes de activar para usuarios

1. En ensayo: recibo sintético, extracción, revisión, confirmación, edición y eliminación. La extracción NO debe crear una compra.
2. Recibo Jumbo original: comprobar manualmente ocho productos, 81,83 €, descuento -34,95 €, total 46,88 €. Los fixtures incluyen importes de referencia y nombres sintéticos: no prueban precisión OCR ni los nombres reales.
3. `Ret Emballage Gekoppeld` debe quedar como advertencia si no tiene interpretación segura. No guardarlo como ajuste por intuición ni solo porque cuadre el total.
4. Doble clic y reintento de guardado deben recuperar una sola compra. Reintento de extracción finalizada debe usar el resultado persistido.
5. Probar fallo de red después de guardar: informar de compra guardada/actualización pendiente, no pedir registrarla otra vez.
6. Confirmar que URLs firmadas duran 120 segundos y no aparecen en localStorage, caché PWA ni logs.
7. En Settings, borrar imágenes seleccionadas/anteriores a una fecha; comprobar que recuentos y estadísticas de compras, productos y ajustes no cambian.
8. Revisar consumo real: el coste depende de tokens de imagen/PDF y salida. Confirmar precios oficiales, no usar una estimación histórica como garantía.

## 6. Estados interrumpidos y recuperación segura

Si el navegador pierde una respuesta, abrir **Subir recibo → Analizar / consultar estado** o recuperar un pendiente. Si la extracción terminó y se persistió, no se vuelve a llamar a OpenAI.

Un timeout, salida incompleta/inválida o fallo de persistencia puede dejar `processing`. **No hay recuperación automática del bloqueo**, porque podría cobrar de nuevo. Un administrador debe revisar el estado, fecha `started_at` y consumo del proveedor; después de comprobar que no hay proceso activo, decidir explícitamente si restaura un resultado disponible o marca error para un nuevo intento potencialmente facturable. No registrar contenido sensible en logs ni resetear todos los trabajos indiscriminadamente. Los errores antes de envío/errores HTTP confirmados recuperables permiten reintento.

Storage y PostgreSQL no tienen una transacción común. Los archivos pendientes se rastrean; cancelación intenta borrarlos y solo limpia `path` después de éxito. Si la eliminación falla, revisar en Settings y reintentar. Si el archivo se borró pero la actualización SQL falla, repetir: la eliminación es segura sobre un objeto ausente. Se conserva el registro, extracción y contabilidad; no quedan archivos anónimos sin referencia deliberadamente.

Borrar una compra conserva su archivo para revisión/limpieza manual. Borrar una imagen no elimina la compra. No hay limpieza anual programada.

## 7. PWA y Android

El manifiesto conserva rutas relativas: desde GitHub Pages resuelven a `/casa-budget/`; incluye PNG 192 y 512 rasterizados del SVG provisional. Display standalone, colores oscuros y cache v8.

Después del despliegue autorizado:

1. Chrome Android: abrir `https://jozeless.github.io/casa-budget/` por HTTPS, comprobar que no hay 404 para manifest, PNG, receipt.js ni receipt-core.js.
2. Cerrar pestañas antiguas y reabrir para cargar el service worker actualizado. En caso de caché antigua, actualizar/reinstalar; no borrar datos de cuenta sin necesidad.
3. Menú Chrome: comprobar **Instalar aplicación** (el texto puede variar por versión), instalar y abrir desde el icono. Debe abrir CASA en standalone, dentro de /casa-budget/.
4. Comprobar selección de galería/cámara, permisos, archivos largos, teclado, revisión desplazable y navegación inferior. Probar también sin conexión: el shell abre; extracción y guardado requieren red.

Chromium de escritorio/CDP y validación de manifiesto ayudan, pero no sustituyen este ensayo en Android real.

## Limitaciones explícitas

- Cantidades actuales: máximo dos decimales. Pesos con tres decimales requieren revisión; no se redondean automáticamente. Se conserva unidad/precio unitario leído en el resultado de extracción como evidencia; la contabilidad usa cantidades/subtotales revisados.
- Total de compra > 0. Devoluciones completas/recibos negativos no se pueden guardar.
- Imágenes: máximo 12 MP, 30.000 píxeles por lado y 10 MB. Se reoptimiza PNG solo si ahorra al menos 20% manteniendo la resolución y los píxeles mostrados; no se redimensiona ni recomprime JPEG ni se rasteriza PDF. Rechazar excesos con mensaje en vez de comprimir sin control.
- PDF: una página sin cifrado, JavaScript, acciones/adjuntos activos; no se rasteriza innecesariamente. HEIC no admitido.
- La IA puede equivocarse aunque su JSON sea correcto. Confirmación humana y conciliación obligatorias.
- Descuentos generales NO se reparten: Data conserva importes brutos de productos y muestra ajustes atribuibles aparte; totales/tiendas usan lo pagado.
- Borrar imágenes conserva metadatos de extracción; no es una solicitud de borrado total de datos personales.

## Entorno reproducible de desarrollo

Node 22 o superior: ejecutar `npm ci --ignore-scripts`. Instalar Chromium de sistema o indicar su binario con `CHROMIUM_PATH`; Playwright se instala como dependencia de desarrollo. `npm test`, `npm run test:ui` y `npm run test:sql` (este último requiere Docker y la imagen postgres:17). Para tipos del servidor: Deno 2, `deno check --no-lock --node-modules-dir=manual supabase/functions/extract-receipt/index.ts` después de npm ci. No hace falta ninguna clave real.
