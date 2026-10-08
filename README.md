# CASA · Compras compartidas (v1)

Una app móvil de gastos del supermercado para dos personas, con Supabase (login + base de datos privada) y GitHub Pages. **Esta primera versión NO utiliza OpenAI ni cobra API.**

## Paso 1: Supabase

1. Abre tu proyecto existente en https://supabase.com/dashboard (puedes reutilizar FutureLabs sin tocar las tablas de la app Kettlebell).
2. Abre **SQL Editor > New query**, pega **todo** el contenido de `schema.sql` y ejecútalo **una sola vez**. Si ya lo ejecutaste, no lo vuelvas a ejecutar sin revisar las políticas existentes.
3. En **Authentication > Providers > Email** activa email/password. Puedes dejar la confirmación por email activada; si lo haces, comprueba tus correos.
4. En **Project Settings > API** (o **Connect / API Keys**, según la interfaz), copia la **Project URL** y la clave pública **anon** / **publishable**. **No uses service_role, secret keys ni claves de OpenAI.**

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
- La suma del gasto por producto solo incluye compras con líneas detalladas. Diferentes abreviaturas de queso se agruparán cuando agreguemos normalización/categorización.
- El presupuesto es el mismo para todos los meses, incluidos los pasados.
- Crear/guardar una compra con productos se hace en dos operaciones; si falla la segunda, la app intenta borrar la compra recién creada. Una versión futura puede usar una RPC transaccional.
- El icono es SVG: instalación y visualización pueden variar según navegador. Las estadísticas no se actualizan en vivo sin recargar; ambos usuarios ven el estado actual al abrir o cambiar de mes.
- Por seguridad, el código de invitación debe compartirse solo con la pareja; cualquier usuario autenticado que posea ese código puede unirse.
- El presupuesto y las compras se sincronizan en Supabase; la app web requiere conexión a internet para cargar los datos.

## Seguridad

No pongas claves secretas en `config.js` ni en repositorios. RLS debe estar habilitado **antes** de introducir gastos personales. En Supabase comprueba que el usuario `anon` no puede leer registros y que cada usuario autenticado solo puede leer su hogar. Esta primera versión no guarda fotografías de recibos.
