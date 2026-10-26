# CASA Budget — CASA 3.3

PWA compartida para el hogar, con **Compras** y **FUN**, identidad oscura/morada y navegación Inicio / Historial / (+) / Data / Settings.

**Esta versión requiere una migración e inicialización manual antes de publicar el cliente.** No hay instalación automática de SQL ni despliegue de la Edge Function. [Guía de instalación y revisión de CASA 3.3](docs/CASA-3.3-FUN-PERIODS.md).

## Presupuestos por recarga

- Compras: **600 €**; FUN: **240 €**, ambos compartidos por los miembros del mismo hogar.
- Cada período empieza en su fecha inclusiva y termina en la fecha exclusiva de la siguiente recarga. No sigue meses calendario, no tiene fecha final programada y no acumula saldos.
- Para el hogar CASA existente, el primer inicio es **2026-10-19**. La migración no adivina su UUID ni lo inicializa automáticamente: el administrador debe identificar hogar/miembro e inicializarlo con la función restringida descrita en la guía.
- Las compras anteriores permanecen intactas y se consultan en «Histórico anterior / pruebas», fuera de los saldos oficiales.
- Un gasto se incluye por su fecha efectiva, aunque se guarde más tarde. No se agrega ni reasigna un `period_id` a transacciones antiguas.
- Las fechas de negocio se interpretan en `Europe/Amsterdam`. No se inicia una recarga al cambiar de mes ni por un temporizador.

Inicio 003 muestra selector Compras/FUN, fecha de inicio y una única tarjeta de saldo con barra de disponibilidad. Verde >50%, naranja >20% y hasta 50%, rojo hasta 20%; saldo negativo visible con barra vacía. No contiene la recomendación semanal ni tarjetas de gastado/presupuesto. Importes extensos se ajustan sin recorte horizontal y el contenido reserva espacio para la navegación/área segura.

## Compras y recibos

Se conservan registro manual, productos, edición, eliminación, advertencia de duplicados y operaciones idempotentes. La compra manual con líneas explícitas exige que su suma coincida con el total declarado.

En recibos, **`purchases.total` es el importe pagado confirmado**. Las líneas/ajustes no tienen que sumar ese total; no se inventan ajustes. Por ejemplo, 28,98 € pagados y líneas de 31,57 € se guardan conservando ambos valores. Cambiar el total exige nueva confirmación. Las cantidades desconocidas y los campos inválidos siguen bloqueados; las propuestas se señalan para revisión.

La selección JPG/PNG/WebP/PDF compatible inicia el flujo habitual de extracción privada. Ninguna compra se guarda automáticamente. La revisión compacta, Opciones avanzadas, original privado, consultas de resultados almacenados y reintentos con el mismo UUID se conservan. No se ha cambiado el prompt, modelo, OCR ni Edge Function. [Configuración de recibos y límites existentes](docs/CASA-3.0-SETUP.md).

Los nuevos guardados normalizan Jumbo y Albert Heijn/AH únicamente en el campo supermercado, manteniendo otros nombres y las correcciones manuales. No modifican productos ni originales; las operaciones ya pendientes conservan su payload exacto.

## FUN

Registro manual de importe positivo (dos decimales), categoría, fecha y descripción opcional. Categorías exactas:

- `Benzine/Parkeren`
- `entree/tickets`
- `food`
- `overig`
- `hotel`

El botón + en FUN abre directamente el formulario, sin recibos. Historial permite consultar, editar y eliminar gastos y seleccionar períodos anteriores. Data muestra resumen y las cinco categorías, con ceros reales cuando no hay gastos; no muestra Tiendas/Productos. Los datos se comparten por hogar y la edición controla revisiones concurrentes.

## Historial, Data y Settings

Los selectores representan períodos de recarga. Compras mantiene búsqueda por producto/supermercado, filtros, detalle, informes de tiendas/productos, historial de producto completamente paginado y evolución por períodos o semanas dentro del período seleccionado. La evolución por períodos termina en el seleccionado.

Los porcentajes comparan el gasto con el presupuesto **almacenado en ese período**, no con `households.monthly_budget`. Los productos mantienen sus importes registrados; los descuentos generales no se reparten artificialmente y los productos no tienen por qué sumar el total pagado.

Settings muestra inicio actual y ambos presupuestos. «Iniciar nuevo período» propone la fecha local actual y pide confirmación de fecha/600 €/240 €. Acepta una fecha pasada posterior al inicio actual, nunca futura ni igual al inicio. Se retira Ajustar presupuesto: los presupuestos históricos son inmutables y las recargas nuevas son fijas.

No hay nuevas suscripciones realtime. Abrir CASA o pulsar Actualizar consulta compras, períodos, presupuestos y FUN; cambiar pantalla, selector o pestaña reutiliza los datos cargados. Tras guardar/eliminar/recargar se actualiza el estado y se consulta de nuevo. Un fallo de lectura posterior a una escritura confirmada se anuncia como actualización pendiente, sin fingir que falló la escritura. Una recarga cuyo resultado no se conoce conserva su UUID, muestra saldo sin verificar y permite reintentar la misma operación.

## Seguridad e instalación

Autenticación, confirmación de correo, recuperación de contraseña, hogares/invitaciones y configuración pública permanecen. `config.js` admite únicamente la URL y clave pública del proyecto CASA; nunca claves OpenAI, `service_role`, contraseñas o claves privadas. Settings conserva sustitución local/restauración de configuración.

Las tablas nuevas tienen RLS por pertenencia al hogar. Sus escrituras pasan por RPC autenticadas y atómicas; no se conceden escrituras directas a clientes. Recargas serializadas por hogar, comprobación del período esperado, exclusión de intervalos solapados, índice de un único período abierto, revisiones FUN e idempotencia protegen operaciones repetidas/concurrentes. La inicialización de hogares existentes es exclusiva del administrador SQL; los hogares nuevos se inicializan al crearse.

Migración nueva: **`migrations/20261025_fun_periods.sql`**, después de Fase 2, CASA 3.0 y CASA 3.2. No cambia transacciones, operaciones anteriores, SQL/RLS existentes ni el despliegue de recibos. Requiere `btree_gist`, extensión soportada por Supabase/PostgreSQL, para la exclusión de solapamientos.

La casa morada de `icon.svg` se comparte con cabecera/PWA; `npm run icons` regenera PNG 192/512 con Chromium. Manifest, `.nojekyll`, icono táctil iOS y scope `/casa-budget/` se conservan. Caché: **`casa-shell-v15-fun-periods`**, instalada como conjunto completo. Recargar/reabrir con conexión para adoptar el cliente nuevo, sin descartar revisiones/operaciones pendientes. No se altera la instalación de otras PWA.

## Desarrollo y pruebas

Node >=22, `npm ci`, Chromium y Playwright; Docker/PostgreSQL 17 para SQL aislado.

- `npm test`: utilidades, fechas Amsterdam/DST, períodos, presupuestos históricos, total pagado, archivos/recibos, autenticación/recuperación y caché.
- `npm run test:home`: Inicio 003, selector, FUN CRUD, períodos/histórico, recarga, fallos/reintentos, permisos de interfaz y gating de migración en 320/360/390/430 px, tablet y escritorio. Capturas `/tmp/casa-3-3-fun-<ancho>.png`.
- `npm run test:ui`: lo anterior y regresiones de compras manuales, edición, duplicados, paginación de productos, recibos, guardados pendientes, autenticación e instalabilidad Chromium. Los casos mensuales/semanales de Inicio 002 se sustituyeron por casos de recarga; la cobertura de operaciones existentes se conserva.
- `npm run test:sql`: aplica migraciones en PostgreSQL 17 desechable, comprueba integridad histórica al repetirlas, RLS, dos miembros, terceros, concurrencia de recargas, rollback de un fallo tras cerrar un período, idempotencia y operaciones existentes. Solo en esa base de pruebas se fija la fecha del servidor al 21 de noviembre de 2026 para comprobar recargas de noviembre.

Las pruebas usan fixtures y servicios simulados. No leen ni modifican Supabase real ni consumen OpenAI. Las utilidades mensuales heredadas de `budget.js` se mantienen para compatibilidad/pruebas y no alimentan saldos o informes de la aplicación 3.3.

Pendiente antes de activar: revisión del SQL y respaldo restaurable, identificación explícita del hogar CASA, inicialización, verificación en Supabase y móviles físicos. **No hacer merge/despliegue hasta completar y aprobar esos pasos.**
