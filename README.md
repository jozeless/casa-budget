# CASA · Compras compartidas (2.5)

Una app móvil de gastos del supermercado para dos personas, con Supabase (login + base de datos privada) y GitHub Pages. **Esta fase NO utiliza OpenAI ni cobra API.**

## Interfaz de CASA 2.0

- **Inicio:** presupuesto, gasto y saldo del mes actual, recomendación para lo que queda de la semana y barra del porcentaje de presupuesto disponible.
- **Historial:** filtro de mes o todos los meses, supermercado y búsqueda por supermercado o productos registrados. Detalles, edición atómica y eliminación con confirmación.
- **Data:** importes reales por supermercado y producto para el mes seleccionado y evolución del gasto de los últimos seis meses. Las compras sin productos detallados no se asignan a productos ni categorías inventadas.
- **Settings:** nombre del hogar, presupuesto, invitación privada, cuenta, configuración pública de Supabase y cierre de sesión.
- **Añadir (+):** compra manual desde cualquier vista. Subir recibos permanece desactivado.

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
