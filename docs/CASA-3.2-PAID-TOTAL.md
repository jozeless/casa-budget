# CASA 3.2 — Aplicación manual del total pagado

## Contrato

`purchases.total` conserva el total pagado confirmado, independiente de la suma de productos y ajustes. Las líneas mantienen sus importes originales. Los descuentos generales se registran separados; la diferencia no produce ajustes artificiales ni cambia el presupuesto. Cantidades desconocidas y datos inválidos siguen rechazándose. La confirmación humana se exige en la interfaz, no se añade un campo de auditoría nuevo en la base de datos.

`casa_save_receipt()` elimina exclusivamente el rechazo por desigualdad. Conserva validaciones individuales, autenticación, hogar, bloqueo de filas, revisiones e idempotencia. `casa_save_purchase()` vuelve a comprobar la igualdad de líneas antes de delegar, después de la recuperación de operaciones ya completadas; las compras sin líneas siguen admitiendo total manual. No cambia la firma ni el payload de ninguna RPC, y se conservan sus propietarios, permisos, RLS y triggers. La detección de posibles duplicados sigue siendo un aviso en el cliente por supermercado, fecha y total pagado; no se añade una restricción que prohíba compras legítimas coincidentes.

## Antes de aplicar

1. Revisar el PR y verificar un respaldo completo y restaurable del esquema/datos. Los CSV por sí solos no respaldan funciones ni RLS.
2. Abrir el proyecto **CASA Budget**, referencia **`eyapzprqhendzpnepdtg`**. No utilizar KB WODS.
3. Confirmar que ya existen las migraciones de Fase 2 y CASA 3.0. Revisar si se han hecho cambios propios a las dos funciones fuera del repositorio: esta migración sustituye sus cuerpos completos y no debe borrar modificaciones no revisadas.
4. Probar primero la migración y las regresiones sobre una copia aislada. El script automatizado usa PostgreSQL 17 desechable con identidades y Storage simulados, no el proyecto Supabase real.

## Aplicar, después de aprobación

En Supabase → SQL Editor, copiar íntegramente **`migrations/20261012_paid_total.sql`** y ejecutarlo una vez. Incluye `BEGIN`/`COMMIT`: un fallo revierte la operación. Se puede repetir con seguridad porque utiliza `CREATE OR REPLACE FUNCTION` y no contiene escrituras de datos, nuevas tablas ni cambios de permisos.

No ejecutar de nuevo `schema.sql` ni migraciones anteriores para aplicar CASA 3.2. En particular, volver a aplicar `20261010_smart_receipts.sql` restablecería las funciones antiguas.

Comprobar las definiciones de `casa_save_receipt` y `casa_save_purchase`: la primera no exige igualdad; la segunda sí cuando hay productos. Verificar que siguen siendo `SECURITY DEFINER`, con `search_path` vacío, y que conservan sus propietarios y permisos de ejecución. Comprobar que los totales, productos y ajustes de las compras existentes permanecen intactos. No hace falta introducir credenciales en CASA ni desplegar la Edge Function: la extracción y su prompt no cambian.

Aplicar SQL antes de activar el frontend CASA 3.2 en una publicación autorizada. Hasta entonces, clientes antiguos siguen bloqueando diferencias en su propia validación. Si un cliente nuevo se encuentra con la RPC antigua, muestra una indicación para aplicar la migración y conserva el recibo pendiente; no hay que cambiar el total ni inventar ajustes.

Tras actualizar la PWA con conexión, recargar o volver a abrir para usar el shell `casa-shell-v13-supermarket-names`. No recargar una revisión sin guardar sin comprobar su recuperación. Probar, cuando se autorice la activación, el total pagado, una edición, las pantallas compartidas y un reintento con el mismo UUID.

## Verificación automatizada

- `npm test`: conciliación no bloqueante, total confirmado obligatorio, campos y cantidades válidos, reconocimiento existente y regresiones de autenticación/datos.
- `npm run test:ui`: respuestas simuladas de Supabase/OpenAI; PNG/JPG/WebP/PDF/cámara, Jumbo, 28,98 € / 31,57 €, opciones avanzadas, invalidación de confirmación, guardado repetido/respuesta perdida y recuperación del payload, importes de Inicio/Historial/Data, filtros, edición, eliminación, móvil/escritorio y PWA.
- `npm run test:sql`: Docker con PostgreSQL 17 sin conexión a Supabase; migración aplicada dos veces, comparación de todas las filas de las ocho tablas públicas antes/después, permisos de RPC, operaciones antiguas, igualdad manual, campos inválidos, pertenencia al hogar, rollback y solicitudes/ediciones concurrentes.

Las pruebas aisladas no sustituyen una comprobación en Supabase real. Cámara, teclado/áreas seguras y lectores de pantalla en Android/iOS físicos requieren comprobación manual. No se consumen solicitudes de OpenAI durante estas pruebas.

## Si algo falla

Antes de `COMMIT`, la transacción revierte las funciones. Después de aplicar, preferir una corrección revisada; restaurar cuerpos antiguos volvería a bloquear la edición de recibos nuevos cuyo desglose difiera del total, aunque no borre esas compras. No restaurar un respaldo completo sin revisar las compras posteriores, ni recalcular compras para adaptarlas a la regla anterior. Conservar los UUID/payloads de operaciones pendientes: la migración no los modifica.
