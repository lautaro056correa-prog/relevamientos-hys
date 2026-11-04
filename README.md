# Relevamientos HyS

App web instalable (PWA) de Higiene y Seguridad en el Trabajo, de uso propio: relevamientos con checklist e informe en Word, seguimiento de desvíos, agenda de visitas con clima, informe semanal al director, constancias de visita y legajo técnico. Funciona sin señal.

**La app:** https://lautaro056correa-prog.github.io/relevamientos-hys/

Este repositorio es público y tiene solo el programa y normativa pública. Los datos de clientes, relevamientos y fotos **no están acá**: quedan en cada dispositivo, y su resguardo son las copias de seguridad (ver abajo). Lo poco que sale del dispositivo se detalla en [Cuenta y servicios](#cuenta-y-servicios).

## Instalarla en el celular

- **Android (Chrome):** abrí el link, tocá ⋮ y después **Instalar app** o **Agregar a la pantalla principal**.
- **iPhone (Safari):** abrí el link, tocá Compartir y después **Agregar a inicio**.

Cada dispositivo guarda sus propios datos. Para pasarlos a otro: descargá una copia en uno y restaurala en el otro.

## Copia de seguridad

**Es la única protección de tus datos:** si perdés el celular o se borran los datos del navegador, lo que no esté en una copia se pierde.

1. En **Más › Mis datos y configuración**, tocá **Descargar copia** una vez por semana.
2. Guardá el archivo `.json` fuera del celular (Drive, la compu). Tiene todos tus clientes y sus fotos: no lo compartas ni lo subas a lugares públicos.
3. Para recuperar, en esa misma pantalla tocá **Restaurar copia** y elegí el archivo.

La app avisa en el Inicio si pasaron 7 días o más sin descargar una copia en ese dispositivo. La copia crece con las fotos: si llega a pesar cerca de 500 MB puede fallar al abrirse en el navegador, así que conviene resolverlo antes.

## Correrla en la compu

Hace falta un servidor local, porque la app lee archivos JSON:

```
web\armar.ps1
cd publicar
python -m http.server 8000
```

Después abrí http://localhost:8000. Si usás Claude Code, también está la configuración `relevamientos` de `.claude/launch.json` (puerto 8765).

## Cómo está armada

| Parte | Dónde |
|---|---|
| Pantallas y comportamiento | `app/app.js`, `app/agenda.js`, `app/agenda-informes.js`, `app/legajo.js` |
| Cuenta, enlace del director, dictado con IA y sincronización (desactivada) | `app/sync.js` |
| Armado de los avisos con la app cerrada, en el celular | `web/sw.js` |
| Estilos | `relevamientos.html` |
| Temas de relevamiento y catálogo del legajo | `modulos/*.json`, `config/legajo.json` |
| Servidor: tablas, reglas y funciones | `supabase/` |
| Página de solo lectura del director | `web/director.html` |

## Publicar una actualización

Una vez hecho lo de GitHub (la primera vez se corre con `-Primera`):

```
web\publicar.ps1 -Mensaje "Qué cambió"
```

Arma la web en `publicar/`, la sube y en un minuto está en línea. El celular toma la versión nueva la próxima vez que abre la app, sin perder datos. Antes de publicar, revisá que no vaya ningún dato personal: el repositorio es público.

## Cuenta y servicios

Los datos **no se sincronizan**. La cuenta (Más › Cuenta) es solo la llave de tres servicios opcionales; sin cuenta, todo lo demás funciona igual. Esto es lo único que sale del dispositivo:

| Servicio | Qué sale | Qué no sale |
|---|---|---|
| **Avisos con la app cerrada** | Una dirección técnica para poder despertar al celular a las 19:00 y a las 08:00. El mensaje se arma en el propio celular. Para el clima, el celular le pide el pronóstico a Open-Meteo con las coordenadas de la visita, igual que la agenda. | Clientes, visitas y cualquier otro dato: el servidor no los conoce. |
| **Enlace para el director** | Un resumen de visitas (cliente, establecimiento, fecha, horario, tareas, observaciones, pendientes y cantidades), el mismo contenido del informe semanal. Se sube solo si creás el enlace y se actualiza cuando cambian las visitas. | Relevamientos, fotos, legajo, contactos, CUIT y direcciones. |
| **Dictado con IA** | Lo que dictás y los nombres de las tareas planificadas, solo cuando tocás "Ordenar con IA". Pasa por el servidor hacia Claude y no se guarda en el servidor. | Todo lo demás. |

**Si algún día querés sincronizar todo:** poné `SINCRONIZAR = true` en `app/sync.js` y publicá. Los datos de los clientes pasarían a estar también en los servidores de Supabase. Ese camino nunca se probó con una cuenta real: hay que probarlo con datos de ejemplo antes de usarlo.

### Configurar el servidor (Supabase), paso a paso

Ya está hecho en el proyecto `obnuhhublcbdaolfpsjh`. Esto es para rehacerlo desde cero, por ejemplo si cambiás de proyecto.

1. Entrá a https://supabase.com, tocá **Start your project** y creá un proyecto (plan Free). Guardá la contraseña de la base en un lugar seguro.
2. Copiá el **Project URL** y la clave **publishable** (Project Settings › API Keys) y ponelos en `app/sync.js` y en `web/director.html`. Esa clave es pública: lo que protege los datos son las reglas de la base. **Nunca** uses ahí la clave `secret` ni `service_role`.
3. Instalá la herramienta de Supabase y conectala (se abre el navegador y pegás un código):
   ```
   npm install supabase
   supabase login
   ```
4. Vinculá el proyecto y creá las tablas y reglas (cambiá la dirección del proyecto en `supabase/migrations/*_avisos_programados.sql` si es otro):
   ```
   supabase link --project-ref TU_PROYECTO
   supabase db push --linked
   supabase config push --project-ref TU_PROYECTO
   ```
5. Corré `.claude\activar-servidor.ps1` (en este repositorio, una copia está en `supabase/`). Sube las funciones y genera las claves de los avisos sin mostrarlas.
6. Creá tu cuenta en la app. Después cerrá las altas nuevas: en `supabase/config.toml` poné `enable_signup = false` y repetí `supabase config push`.

### Límites del plan gratis

500 MB de datos y 1 GB de archivos. Los proyectos sin actividad durante una semana se pausan y se reactivan desde el panel de Supabase. Las fotos de registros borrados no se eliminan solas del almacenamiento.

### Cargar la clave de la API de Claude (dictado con IA)

Solo hace falta para el dictado con IA: sin la clave, todo lo demás funciona igual. Se paga por uso.

1. Entrá a https://console.anthropic.com, cargá crédito y creá una clave en **API Keys**.
2. Corré `.claude\cargar-clave-claude.ps1` (en este repositorio, una copia está en `supabase/`) y pegá la clave cuando te la pida. No se ve en pantalla ni queda en ningún archivo.

La clave queda como secreto del servidor y la usa solo la función `supabase/functions/ordenar-dictado`: **nunca** va en el código de la app ni llega al navegador. No la pegues en un chat ni en un archivo. El dictado usa el modelo `claude-opus-5-5`; se cambia en esa misma función.
