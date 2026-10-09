# Fase 2: aplicación manual

Archivo: `20261009_phase_2.sql`. No ejecutarlo en KB WODS ni como parte del arranque de la PWA. No requiere ninguna clave secreta en el cliente.

1. Revisar el PR y el SQL. Verificar en el panel que el proyecto es **CASA Budget**, cuya Project URL pública termina en `eyapzprqhendzpnepdtg.supabase.co`.
2. Obtener una copia de seguridad/exportación recuperable de las tablas actuales. Probar primero en un proyecto separado o PostgreSQL desechable con datos ficticios. `node scripts/check-sql.cjs` crea y elimina su propio contenedor, sin leer `config.js` ni conectarse a Supabase.
3. Ejecutar **solamente** este archivo en SQL Editor, con permisos administrativos y en una ventana con poca actividad. Tiene `BEGIN/COMMIT`: un error revierte la migración completa. No volver a ejecutar `schema.sql` en un proyecto existente.
4. Verificar que existen `purchases.revision`, las RPC y sus permisos; comparar recuentos y totales con la copia previa. No se cambian importes, fechas, hogares, autores ni nombres históricos. El índice nuevo y los bloqueos DDL pueden interrumpir brevemente escrituras: revisar antes en proyectos grandes.
5. Antes de desplegar el cliente, probar con dos miembros del hogar y con un usuario ajeno: edición, conflicto, retry de la misma operación, historial Todo, y rechazo de accesos ajenos. Refrescar pestañas antiguas tras el despliegue.

La migración es aditiva y reaplicable. Mantiene las políticas RLS existentes. Las dos RPC están restringidas a `authenticated`; la de escritura comprueba `auth.uid()`, pertenencia al hogar, bloquea la compra y verifica su revisión. Toda la escritura, sus productos y el resultado idempotente se confirman en una transacción. El historial utiliza `SECURITY INVOKER` y las políticas de lectura existentes.

La tabla `purchase_operations` no es accesible directamente desde el cliente. Guarda la solicitud y resultado por usuario/UUID. No contiene credenciales. Debe conservarse para reconocer reintentos: borrarla o purgar entradas sin definir antes el plazo de reintento rompe esa garantía. Su tamaño crecerá con las operaciones; en esta fase no hay purga automática.

Los IDs de compra, autores y fechas de creación se conservan en ediciones. Las líneas se sustituyen dentro de la transacción y reciben IDs nuevos; no hay referencias externas a líneas en el esquema actual. Los triggers aumentan la revisión también cuando el cliente antiguo inserta líneas. No convierten las escrituras del cliente antiguo en operaciones atómicas: tras aplicar la migración, actualizar sus pestañas.

Sin la migración, la PWA conserva la lectura de la Fase 1 y explica que el alta/edición de Fase 2 no está disponible; no intenta una escritura parcial como alternativa.

## Recuperación

Ante un error de aplicación, volver temporalmente al cliente anterior y mantener las adiciones SQL. No borrar operaciones ni revertir datos automáticamente. No se proporciona rollback destructivo: cualquier retirada de funciones/columnas requiere revisar previamente los clientes activos y las copias de seguridad.

## Pruebas y límites

PostgreSQL aislado replica `auth.uid()` con usuarios ficticios y ejecuta las políticas RLS reales de `schema.sql`. Comprueba rollback después de un fallo durante la inserción, idempotencia, solicitudes concurrentes, conflictos simultáneos, validación y aislamiento entre hogares. No reproduce el servicio Auth, PostgREST, correo ni toda la configuración de Supabase. Los permisos finales del proyecto y el flujo remoto deben comprobarse manualmente después de aplicar la migración autorizada.
