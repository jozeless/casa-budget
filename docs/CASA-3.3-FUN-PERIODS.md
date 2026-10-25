# CASA 3.3 — Instalación manual y decisiones

## Alcance y precondiciones

Archivo: **`migrations/20261025_fun_periods.sql`**. Aplicar después de `schema.sql` y las migraciones existentes de Fase 2, recibos y total pagado independiente (`20261012_paid_total.sql`). En una instalación existente no volver a ejecutar esos archivos antiguos: pueden restablecer contratos anteriores.

El proyecto correcto es **CASA Budget**, referencia **`eyapzprqhendzpnepdtg`**, nunca KB WODS. No hace falta cambiar secretos ni desplegar Edge Functions. La migración prepara tablas/RPC/índices/políticas y un trigger para hogares creados en el futuro; no inicializa ni modifica hogares ya existentes y no reescribe transacciones.

## Orden seguro

1. Revisar este PR, SQL y pruebas. Obtener un respaldo completo y comprobar una restauración aislada, incluyendo esquema, funciones, RLS y datos. Los CSV solos no son un respaldo del esquema. Conservar también el respaldo apropiado de archivos privados si corresponde.
2. Comprobar el proyecto CASA correcto y los permisos de administrador SQL. Registrar conteos/importes originales de compras, productos, ajustes, recibos y operaciones para comparar después.
3. Probar primero en una copia aislada. Ejecutar **solo la migración nueva completa** en SQL Editor. Incluye `BEGIN`/`COMMIT`; un error revierte el conjunto. `CREATE EXTENSION IF NOT EXISTS btree_gist` es necesario para la exclusión de intervalos; se usa su esquema real incluso si ya estaba instalada. No hay DML de transacciones históricas.
4. Identificar inequívocamente el hogar CASA y un miembro responsable a partir de las tablas existentes. El nombre del hogar no se considera único. Consultas de inspección, sin compartir resultados/credenciales con terceros:

```sql
select id, name from public.households;
select household_id, user_id from public.household_members;
```

5. Sustituir **ambos** marcadores por los UUID verificados y ejecutar como administrador SQL, una vez. No utilizar UUIDs de pruebas ni elegir el primer hogar de una lista:

```sql
select public.casa_initialize_periods(
  'PEGAR_UUID_DEL_HOGAR_CASA'::uuid,
  'PEGAR_UUID_DE_UN_MIEMBRO_VALIDADO'::uuid,
  date '2026-10-19'
);
```

La función está revocada para `anon`/`authenticated`: no es una API para clientes. Comprueba la pertenencia del miembro y bloquea el hogar. Guarda al miembro validado como responsable de la inicialización y la hora real de registro. Repetir la llamada con el mismo inicio devuelve el primer período, sin resetear saldos ni auditoría; otro inicio se rechaza. Si el hogar no puede identificarse inequívocamente, **detenerse y verificarlo**. No cambiar otro hogar ni forzar una fecha sobre períodos existentes.

Los hogares creados después de la migración reciben automáticamente un primer período desde la fecha Amsterdam de su creación, con 600 €/240 €. No aplicarles manualmente el inicio del hogar CASA antiguo.

6. Verificar que CASA tiene exactamente un período abierto, inicio **2026-10-19**, Compras **600**, FUN **240**, actor/hora de auditoría. Verificar ausencia de solapamientos y que conteos/importes históricos anteriores no cambiaron. Las compras del 18/10 y anteriores permanecen en `purchases`, pero no entran en el saldo oficial. FUN empieza vacío.
7. Solo después de esas verificaciones y de aprobar el PR, integrar/publicar el cliente mediante el proceso manual habitual. Abrir/recargar la PWA para adoptar `casa-shell-v15-fun-periods`. No interrumpir una revisión o escritura pendiente sin comprobar su recuperación. Crear/unirse a un hogar comprueba la presencia del esquema antes de invocar las RPC existentes. Un cliente nuevo sin migración/inicialización muestra error y bloquea escrituras; no utiliza un saldo mensual de respaldo.
8. Tras autorizar la activación, comprobar ambos miembros, selector, recarga y gastos desde dispositivos reales. No crear períodos de prueba en el hogar real: usar una copia aislada para ensayos y concurrencia.

## Modelo y contratos

- `budget_periods`: fechas, presupuestos separados, `created_by` y `created_at`. Intervalos `[starts_on, ends_on)`; `NULL` significa hasta nueva recarga. Una exclusión GiST impide solapamientos, un índice único impide dos abiertos y un trigger impide cambiar datos/auditoría presupuestaria o reabrir/eliminar períodos cerrados. El primer cierre del período abierto solo puede establecer su fecha final; las RPC hacen cierre/apertura juntos.
- `fun_expenses`: importe, categoría exacta, fecha efectiva, descripción, creador/hora y revisión. Sin FK de período: la asignación es una consulta por fecha. Editar una fecha por una acción humana puede cambiar a qué intervalo pertenece; la migración no cambia esas fechas.
- `budget_operations`: UUID por usuario, payload y resultado. No tiene lectura ni escritura directa para clientes. No modifica `purchase_operations` ni sus UUIDs existentes.
- `casa_start_period`: requiere miembro autenticado, bloquea el hogar, recupera el UUID antes de validar el estado actual, comprueba el período esperado y fecha posterior/no futura, cierra el anterior y crea el nuevo con 600 €/240 € dentro de la misma transacción. Dos usuarios que confirmen sobre el mismo período producen un ganador y un conflicto `40001`.
- `casa_fun_write`: crea/edita/elimina, valida hogar/importe/categoría/fecha, controla revisión y conserva creador al editar. Las eliminaciones también son idempotentes. Los clientes solo tienen SELECT por RLS en períodos y FUN.
- `casa_budget_today`: fecha de negocio del servidor en `Europe/Amsterdam`, sin offsets UTC fijos. No accesible directamente por clientes. Las pruebas sustituyen esta función únicamente dentro de la base desechable; **nunca ejecutar `tests/sql/*.sql` en producción**.

Los presupuestos están congelados, incluso si un cliente antiguo cambia el campo legado `households.monthly_budget`. La UI retira Ajustar presupuesto; modificar los importes fijos de futuros períodos requeriría otra decisión/cambio explícito. No se acumulan importes ni se programa la siguiente recarga.

Compras utiliza solo `purchases.total` dentro del rango; el total pagado y el contrato manual de líneas se conservan. Los informes usan el presupuesto de cada período. Los filtros con IDs DOM antiguos que contienen `month` ahora guardan IDs de período, no `YYYY-MM`. El histórico anterior no tiene presupuesto oficial; no se inventa un porcentaje contra 600 €.

## Fallos y sincronización

Cambiar selector/pantalla reutiliza el snapshot cargado. Actualizar/abrir y las operaciones confirmadas recargan períodos, FUN y compras. No hay realtime nuevo: el otro miembro utiliza Actualizar o reabre la app para ver cambios externos.

Ante resultado de recarga desconocido se conserva el UUID/payload, el saldo se marca sin verificar y se bloquean nuevas escrituras hasta consultar/reintentar. Si la escritura se confirma pero la lectura posterior falla, se anuncia como confirmada con actualización pendiente. No repetirla como una recarga nueva. Los reintentos confirmados conservan sus datos originales incluso si el período ya cambió.

## Verificación y pendientes

`npm test`, `npm run test:ui` y `npm run test:sql` usan solo datos simulados/PostgreSQL 17 desechable. Cubren 19/10 inclusive, exclusión 18/10, cruce octubre/noviembre, recarga 20/11 y otra fecha, no acumulación, DST Amsterdam, permisos, edición, errores, pérdida de respuesta, concurrencia, idempotencia, congelación histórica y recibos con líneas diferentes del total pagado. La instalación/inicialización real y teléfonos físicos quedan pendientes de revisión humana.

Si falla la migración antes de commit, la transacción revierte. Después de crear períodos reales, no borrar tablas ni volver a funciones antiguas para adaptar saldos. Preferir una corrección hacia delante revisada; restaurar un respaldo sin revisar operaciones posteriores puede perder datos nuevos. Los UUIDs pendientes no deben borrarse a ciegas.
