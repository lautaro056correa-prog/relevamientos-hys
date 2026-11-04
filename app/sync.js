// Sincronización con Supabase, cuenta del usuario, avisos con la app cerrada, enlace del director y dictado con IA.
// La app sigue trabajando siempre contra los datos del dispositivo (IndexedDB): cada put/del de app.js anota el registro
// en la cola "sync_cola" y, cuando hay sesión y señal, se sube y se baja lo de los otros dispositivos.
// Si dos dispositivos cambian lo mismo, gana la última modificación. Las fotos y los PDF van al almacenamiento "archivos"
// y en la fila queda solo la referencia hysfile:<huella>.<ext>. Se carga antes que app.js.
const Sync = (() => {
  // El usuario eligió NO sincronizar (nov-2026): trabaja con copias de seguridad. Con false no hay cuenta, nube, avisos con la
  // app cerrada, enlace del director ni dictado con IA, y nada sale del dispositivo. Para activarla: true acá,
  // enable_signup = true en supabase/config.toml + "supabase config push", y publicar.
  const HABILITADA = false;
  const URL_SB = 'https://obnuhhublcbdaolfpsjh.supabase.co', CLAVE_PUBLICA = 'sb_publishable_cP6fsViS7VW3ydIM-Oikjw_wY538Eyd';
  const VAPID_PUBLICA = 'BNwQ8n8zmJikKzeO-nRBpnpOVKAWBc7PEDQd81hg_Z_i7bK47QX8FF0mZKa0_u91Wp7j6BP53dxDAS8B3piHR2U';
  const WEB = 'https://lautaro056correa-prog.github.io/relevamientos-hys/';
  const views = {}, acciones = {}, prev = {};
  // Cajones que viajan a la nube; de "config" no viajan lo que es propio de cada dispositivo
  const STORES_SYNC = ['empresas', 'establecimientos', 'relevamientos', 'seguimiento', 'visitas', 'pendientes', 'semanas', 'legajo', 'config'];
  const NO_SYNC_CONFIG = new Set(['clima', 'feriados', 'syncEstado']);
  const sincronizable = (store, id) => STORES_SYNC.includes(store) && !(store === 'config' && NO_SYNC_CONFIG.has(id));

  let sb = null, sesion = null, corriendo = false, otraVez = false, timer = null, ultima = 0, error = '', progreso = '';
  const usuario = () => sesion?.user || null;
  const activo = () => !!usuario();

  // Escrituras directas, que no vuelven a la cola
  const crudoGet = (s, id) => tx(s, 'readonly', o => o.get(id));
  const crudoPut = (s, v) => tx(s, 'readwrite', o => o.put(v));
  const crudoDel = (s, id) => tx(s, 'readwrite', o => o.delete(id));

  // ===== Cola: la llama app.js en cada put/del =====
  function anotar(store, id, borrado = false){
    if (!HABILITADA || !sincronizable(store, id)) return Promise.resolve();
    const fila = {id: `${store}|${id}`, store, rid: id, modificado: Date.now(), borrado};
    return crudoPut('sync_cola', fila).catch(() => {}).then(() => programar());
  }
  function programar(ms = 6000){
    if (!activo()) return;
    clearTimeout(timer);
    timer = setTimeout(sincronizar, ms);
  }

  // ===== Fotos y documentos =====
  const huella = async txt => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const EXT = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf'};
  const esData = x => typeof x === 'string' && x.startsWith('data:') && x.length > 256;
  const nombreDe = async dataUrl => `${await huella(dataUrl)}.${EXT[dataUrl.slice(5, dataUrl.indexOf(';'))] || 'bin'}`;
  async function subirArchivo(dataUrl){
    const nombre = await nombreDe(dataUrl), clave = 'f|' + nombre;
    if (await crudoGet('sync_ver', clave)) return 'hysfile:' + nombre;
    const blob = await AG.aBlob(dataUrl);
    const {error: e} = await sb.storage.from('archivos').upload(`${usuario().id}/${nombre}`, blob, {contentType: blob.type, upsert: false});
    if (e && !/exists|duplicate/i.test(e.message || '') && String(e.statusCode) !== '409') throw new Error('No se pudo subir un archivo: ' + e.message);
    await crudoPut('sync_ver', {id: clave});
    return 'hysfile:' + nombre;
  }
  // Recorre un registro cambiando cada hoja de texto con la función dada
  async function recorrer(x, fn){
    if (typeof x === 'string') return fn(x);
    if (Array.isArray(x)) { const out = []; for (const y of x) out.push(await recorrer(y, fn)); return out; }
    if (x && typeof x === 'object') { const out = {}; for (const k of Object.keys(x)) out[k] = await recorrer(x[k], fn); return out; }
    return x;
  }
  const desinflar = reg => recorrer(reg, s => esData(s) ? subirArchivo(s) : s);
  async function inflar(reg, local){
    // Lo que ya está en este dispositivo no se vuelve a bajar
    const conocidos = {};
    if (local) await recorrer(local, async s => { if (esData(s)) conocidos[await nombreDe(s)] = s; return s; });
    return recorrer(reg, async s => {
      if (!s.startsWith('hysfile:')) return s;
      const nombre = s.slice(8);
      if (conocidos[nombre]) return conocidos[nombre];
      const {data, error: e} = await sb.storage.from('archivos').download(`${usuario().id}/${nombre}`);
      if (e) throw new Error('No se pudo bajar un archivo: ' + e.message);
      return AG.aDataUrl(data);
    });
  }

  // ===== Primera vez en este dispositivo: copia de seguridad y todo lo local a la cola =====
  async function primeraVez(){
    const uid = usuario().id;
    let est = await crudoGet('config', 'syncEstado');
    if (est?.uid === uid && est.inicial) return est;
    let total = 0;
    for (const store of STORES_SYNC) {
      for (const r of await tx(store, 'readonly', o => o.getAll())) {
        if (!sincronizable(store, r.id)) continue;
        const k = `${store}|${r.id}`;
        if (await crudoGet('sync_cola', k)) continue;
        // Con fecha vieja: si en la nube hay una versión posterior, esa es la que queda
        await crudoPut('sync_cola', {id: k, store, rid: r.id, modificado: r.mod || r.creado || 1, borrado: false});
        total++;
      }
    }
    if (total && !est?.copia) {
      progreso = 'Guardando una copia de seguridad antes de subir…';
      refrescar();
      try { await A.exportar(); } catch (e) { console.warn('Copia', e); }
    }
    est = {id: 'syncEstado', uid, inicial: true, copia: true, seq: 0};
    await crudoPut('config', est);
    return est;
  }

  // ===== Subir y bajar =====
  async function subir(){
    const cola = await tx('sync_cola', 'readonly', o => o.getAll());
    for (let i = 0; i < cola.length; i += 20) {
      progreso = `Subiendo ${Math.min(i + 20, cola.length)} de ${cola.length}…`;
      refrescar();
      const lote = cola.slice(i, i + 20), filas = [];
      for (const c of lote) {
        const reg = c.borrado ? null : await crudoGet(c.store, c.rid);
        filas.push({store: c.store, id: c.rid, modificado: c.modificado, borrado: !reg, data: reg ? await desinflar(reg) : null});
      }
      const {error: e} = await sb.rpc('sync_guardar', {filas});
      if (e) throw new Error(e.message);
      for (const c of lote) {
        await crudoPut('sync_ver', {id: c.id, modificado: c.modificado});
        // Si se volvió a modificar mientras subía, queda en la cola para la próxima
        const actual = await crudoGet('sync_cola', c.id);
        if (actual?.modificado === c.modificado) await crudoDel('sync_cola', c.id);
      }
    }
  }
  async function bajar(){
    const est = await crudoGet('config', 'syncEstado');
    let seq = est?.seq || 0, cambios = 0;
    for (;;) {
      const {data, error: e} = await sb.from('registros').select('store,id,data,modificado,borrado,sync_seq').gt('sync_seq', seq).order('sync_seq').limit(50);
      if (e) throw new Error(e.message);
      if (!data.length) break;
      for (const f of data) {
        const k = `${f.store}|${f.id}`, ver = await crudoGet('sync_ver', k), pend = await crudoGet('sync_cola', k);
        if (sincronizable(f.store, f.id) && ver?.modificado !== f.modificado && !(pend && pend.modificado > f.modificado)) {
          progreso = `Bajando novedades (${++cambios})…`;
          refrescar();
          if (f.borrado) await crudoDel(f.store, f.id);
          else await crudoPut(f.store, await inflar(f.data, await crudoGet(f.store, f.id)));
          await crudoPut('sync_ver', {id: k, modificado: f.modificado});
          if (pend) await crudoDel('sync_cola', k);
        }
        seq = f.sync_seq;
        await crudoPut('config', {...est, id: 'syncEstado', seq});
      }
    }
    return cambios;
  }
  async function sincronizar(){
    if (!activo() || !navigator.onLine) { refrescar(); return; }
    if (corriendo) { otraVez = true; return; }
    corriendo = true;
    clearTimeout(timer);
    try {
      await primeraVez();
      await subir();
      const cambios = await bajar();
      ultima = Date.now();
      error = '';
      pref.set('ultimaSync', String(ultima));
      if (cambios) {
        await recargarDatos();
        // Si está cargando algo, no se le cambia la pantalla de golpe
        if (esRaiz(S.view) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) render();
        else toast('Llegaron datos de otro dispositivo');
      }
    } catch (e) {
      console.warn('Sincronización', e);
      error = e.message || String(e);
    } finally {
      corriendo = false;
      progreso = '';
      refrescar();
      if (otraVez) { otraVez = false; programar(1000); }
    }
  }
  // Actualiza lo que se ve del estado sin redibujar toda la pantalla
  function refrescar(){
    const c = document.getElementById('syncEstado');
    if (c) textoEstado().then(t => { const x = document.getElementById('syncEstado'); if (x) x.innerHTML = t; });
    const b = document.getElementById('syncBoton');
    if (b) b.outerHTML = botonNube();
  }
  async function pendientes(){ try { return await tx('sync_cola', 'readonly', o => o.count()); } catch { return 0; } }
  async function textoEstado(){
    const n = await pendientes(), u = +pref.get('ultimaSync');
    const cuando = u ? new Date(u).toLocaleString('es-AR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : 'todavía no';
    if (progreso) return `<b>${esc(progreso)}</b>`;
    if (!navigator.onLine) return `<b>Sin señal.</b> Podés seguir trabajando: ${n ? plural(n, 'cambio queda', 'cambios quedan') + ' para subir' : 'está todo subido'} cuando vuelva.`;
    if (error) return `<b class="txt-bad">No se pudo sincronizar.</b> ${esc(error)}<br>Tus datos siguen seguros en este dispositivo; se reintenta solo.`;
    return `<b>${n ? plural(n, 'cambio por subir', 'cambios por subir') : 'Todo sincronizado'}</b><br>Última sincronización: ${cuando}`;
  }
  // Botón del encabezado del Inicio
  const botonNube = () => !HABILITADA ? '' : `<button class="hbtn" id="syncBoton" ${on('go', 'cuenta')} aria-label="${activo() ? (error ? 'Problema de sincronización' : 'Sincronización activa') : 'Activar la sincronización'}"><span class="nube ${activo() ? (error ? 'mal' : 'bien') : ''}">${ic('nube')}</span></button>`;

  // ===== Cuenta =====
  const conectando = {p: null};
  function conectar(){
    return conectando.p ||= (async () => {
      await AG.lib('supabase');
      sb = window.supabase.createClient(URL_SB, CLAVE_PUBLICA, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}});
      sb.auth.onAuthStateChange((ev, s) => {
        const antes = activo();
        sesion = s;
        if (ev === 'PASSWORD_RECOVERY') { S.nuevaClave = true; S.tab = 'mas'; go('cuenta'); }
        if (!antes && s) programar(500);
        refrescar();
      });
      const {data} = await sb.auth.getSession();
      sesion = data.session;
    })().catch(e => { conectando.p = null; throw e; });
  }
  const ERRORES = [[/invalid login/i, 'El email o la contraseña no coinciden.'], [/already registered|already been registered/i, 'Ese email ya tiene cuenta: tocá "Entrar".'], [/signups? not allowed|signup.*disabled/i, 'La cuenta de esta app ya está creada: entrá con tu email y contraseña.'],
    [/at least|should be|weak/i, 'La contraseña tiene que tener al menos 8 caracteres.'], [/invalid.*email|email.*invalid/i, 'Revisá el email: no parece válido.'], [/rate limit|too many/i, 'Hubo demasiados intentos. Probá de nuevo en un rato.'], [/fetch|network/i, 'No hay conexión. Probá de nuevo cuando tengas señal.']];
  const traducir = e => ERRORES.find(([r]) => r.test(e?.message || ''))?.[1] || e?.message || 'Ocurrió un error.';

  views.cuenta = {
    title: () => 'Cuenta y sincronización',
    async html(){
      try { await conectar(); } catch (e) { return aviso('aviso', 'alerta', 'Para activar la sincronización hace falta señal. La app sigue funcionando normalmente con tus datos en este dispositivo.'); }
      if (S.nuevaClave) return `<div class="card"><h4>Elegí tu nueva contraseña</h4><label for="cu_nueva">Contraseña nueva</label><input id="cu_nueva" type="password" autocomplete="new-password" minlength="8">
        <button class="btn block" style="margin-top:12px" ${on('cuNuevaClave')}>${ic('check')}Guardar contraseña</button></div>`;
      if (!activo()) return `<div class="stack">
        ${aviso('info', 'nube', 'Con una cuenta, tus datos se guardan también en la nube, protegidos con tu usuario: los ves en el celular y en la compu, y no se pierden si cambiás de teléfono. La app sigue funcionando sin señal.')}
        <div class="card"><label for="cu_mail">Email</label><input id="cu_mail" type="email" inputmode="email" autocomplete="username">
          <label for="cu_clave">Contraseña</label><input id="cu_clave" type="password" autocomplete="current-password">
          <p class="hint">Al menos 8 caracteres. Guardala bien: es la llave de tus datos.</p>
          <div class="actions" style="margin-top:12px"><button class="btn" ${on('cuEntrar')}>Entrar</button><button class="btn sec" ${on('cuCrear')}>Crear mi cuenta</button></div>
          <a class="link" style="display:inline-block;margin-top:14px" ${on('cuOlvide')}>Me olvidé la contraseña</a></div></div>`;
      const push = await estadoPush();
      return `<div class="stack">
        <div class="card"><div class="sub">Sesión iniciada como</div><b style="font-size:17px;overflow-wrap:anywhere">${esc(usuario().email)}</b></div>
        <div class="card"><div id="syncEstado">${await textoEstado()}</div>
          <button class="btn sec block" style="margin-top:12px" ${on('cuSincronizar')}>${ic('auto')}Sincronizar ahora</button></div>
        <div class="card"><h4>Avisos en este dispositivo</h4>
          <p class="sub" style="margin-top:0">Te llegan aunque la app esté cerrada: la noche anterior, el resumen de las visitas de mañana con su clima; a la mañana, las visitas sin cerrar; y las alertas de clima nuevas.</p>
          ${push === 'activo' ? `<div class="okbox">${ic('ok')}<div>Avisos activados en este dispositivo.</div></div><div class="actions" style="margin-top:10px"><button class="btn sec small" ${on('cuPushPrueba')}>Mandar un aviso de prueba</button><button class="btn ghost small" ${on('cuPushQuitar')}>Desactivar</button></div>`
            : push === 'bloqueado' ? aviso('aviso', 'alerta', 'El navegador tiene bloqueados los avisos para esta app. Activalos desde los permisos del navegador.')
            : push === 'noSoportado' ? aviso('aviso', 'info', 'Este navegador no permite avisos con la app cerrada. En iPhone, primero instalá la app en la pantalla de inicio.')
            : `<button class="btn block" ${on('cuPushActivar')}>${ic('campana')}Activar avisos</button>`}</div>
        <button class="btn ghost block" ${on('cuSalir')}>Cerrar sesión</button>
        <p class="sub" style="margin:0">Al cerrar sesión, los datos quedan en este dispositivo y deja de sincronizar hasta que vuelvas a entrar.</p></div>`;
    }
  };
  prev.cuenta = 'mas';
  acciones.cuEntrar = async () => {
    const email = $('#cu_mail').value.trim(), password = $('#cu_clave').value;
    if (!email || !password) return avisar('Poné tu email y tu contraseña.');
    toast('Entrando…');
    const {data, error: e} = await sb.auth.signInWithPassword({email, password});
    if (e) return avisar(traducir(e));
    sesion = data.session;
    toast('Sesión iniciada');
    render();
    sincronizar();
  };
  acciones.cuCrear = async () => {
    const email = $('#cu_mail').value.trim(), password = $('#cu_clave').value;
    if (!email || !password) return avisar('Poné tu email y elegí una contraseña.');
    if (password.length < 8) return avisar('La contraseña tiene que tener al menos 8 caracteres.');
    if (!(await confirmar(`¿Crear la cuenta con ${email}? Los datos de este dispositivo se suben a tu cuenta (antes se descarga una copia de seguridad).`, 'Crear cuenta'))) return;
    const {data, error: e} = await sb.auth.signUp({email, password, options: {emailRedirectTo: WEB}});
    if (e) return avisar(traducir(e));
    if (!data.session) return avisar('Te mandamos un mail para confirmar la cuenta. Abrilo y después entrá con tu email y contraseña.');
    sesion = data.session;
    toast('Cuenta creada');
    render();
    sincronizar();
  };
  acciones.cuOlvide = async () => {
    const email = $('#cu_mail').value.trim();
    if (!email) return avisar('Escribí tu email arriba y volvé a tocar "Me olvidé la contraseña".');
    const {error: e} = await sb.auth.resetPasswordForEmail(email, {redirectTo: WEB});
    if (e) return avisar(traducir(e));
    avisar('Te mandamos un mail para elegir una contraseña nueva.');
  };
  acciones.cuNuevaClave = async () => {
    const password = $('#cu_nueva').value;
    if (password.length < 8) return avisar('La contraseña tiene que tener al menos 8 caracteres.');
    const {error: e} = await sb.auth.updateUser({password});
    if (e) return avisar(traducir(e));
    S.nuevaClave = false;
    toast('Contraseña actualizada');
    render();
  };
  acciones.cuSincronizar = async () => { toast('Sincronizando…'); await sincronizar(); if (!error) toast('Listo'); };
  acciones.cuSalir = async () => {
    if (!(await confirmar('¿Cerrar la sesión? Los datos quedan en este dispositivo, pero deja de sincronizar.', 'Cerrar sesión'))) return;
    await sb.auth.signOut({scope: 'local'});
    sesion = null;
    render();
  };

  // ===== Avisos con la app cerrada (Web Push) =====
  const b64aBytes = b => Uint8Array.from(atob(b.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b.length / 4) * 4, '=')), c => c.charCodeAt(0));
  const registroSW = async () => (navigator.serviceWorker && await navigator.serviceWorker.getRegistration()) || null;
  async function estadoPush(){
    if (!('PushManager' in window) || !window.Notification) return 'noSoportado';
    if (Notification.permission === 'denied') return 'bloqueado';
    const reg = await registroSW();
    if (!reg) return 'noSoportado';   // sin service worker (por ejemplo, probando sin instalar)
    return (await reg.pushManager.getSubscription()) ? 'activo' : 'apagado';
  }
  acciones.cuPushActivar = async () => {
    if ((await Notification.requestPermission()) !== 'granted') return avisar('Sin permiso no se pueden mandar avisos.');
    const reg = await registroSW();
    const sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64aBytes(VAPID_PUBLICA)});
    const j = sub.toJSON();
    const {error: e} = await sb.from('push_suscripciones').upsert({user_id: usuario().id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth});
    if (e) return avisar('No se pudieron activar los avisos: ' + e.message);
    toast('Avisos activados');
    render();
    pruebaPush();
  };
  async function pruebaPush(){
    const {error: e} = await sb.functions.invoke('avisos', {body: {prueba: true}});
    if (e) await avisar('Los avisos quedaron activados, pero no se pudo mandar el de prueba: ' + e.message);
  }
  acciones.cuPushPrueba = async () => { await pruebaPush(); toast('Aviso de prueba enviado'); };
  acciones.cuPushQuitar = async () => {
    const reg = await registroSW(), sub = await reg.pushManager.getSubscription();
    if (sub) { await sb.from('push_suscripciones').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    toast('Avisos desactivados');
    render();
  };

  // ===== Enlace de solo lectura para el director =====
  async function directorHtml(){
    if (!HABILITADA) return '';
    if (!activo()) return `<h3>Enlace para el director</h3>${aviso('info', 'link', `Para generar un enlace de solo lectura, iniciá sesión. <a class="link" ${on('go', 'cuenta')}>Activar</a>`)}`;
    const enlace = await getOne('config', 'directorEnlace');
    return `<h3>Enlace para el director</h3><div class="card">
      <p class="sub" style="margin-top:0">Página de solo lectura con las visitas, el cumplimiento y los gráficos. No muestra tu configuración ni el detalle de los relevamientos.</p>
      ${enlace ? `<input aria-label="Enlace para el director" readonly value="${esc(WEB + 'director.html#t=' + enlace.token)}">
        <div class="actions" style="margin-top:10px"><button class="btn sec small" ${on('dirCompartir')}>${ic('compartir')}Compartir</button><button class="btn ghost small" ${on('dirRegenerar')}>Regenerar (anula el anterior)</button></div>`
        : `<button class="btn sec block" ${on('dirRegenerar')}>${ic('link')}Crear enlace</button>`}</div>`;
  }
  acciones.dirRegenerar = async () => {
    const hay = await getOne('config', 'directorEnlace');
    if (hay && !(await confirmar('El enlace anterior deja de funcionar. ¿Crear uno nuevo?', 'Crear otro'))) return;
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
    const {error: e} = await sb.from('enlaces_director').upsert({user_id: usuario().id, token_hash: await huella(token)});
    if (e) return avisar('No se pudo crear el enlace: ' + e.message);
    await put('config', {id: 'directorEnlace', token});
    toast('Enlace listo');
    render();
  };
  acciones.dirCompartir = async () => {
    const e = await getOne('config', 'directorEnlace'), url = WEB + 'director.html#t=' + e.token;
    if (navigator.share) { try { await navigator.share({title: 'Visitas de Higiene y Seguridad', url}); return; } catch (x) { if (x?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { avisar(url); }
  };

  // ===== Dictado con IA: propone, y solo se guarda lo que se confirma =====
  acciones.abrirDictadoIA = async () => {
    if (!activo()) { await avisar('El dictado con IA necesita que inicies sesión.'); return go('cuenta'); }
    S.dictado = {texto: '', propuesta: null};
    go('dictadoIA');
  };
  prev.dictadoIA = 'visita';
  views.dictadoIA = {
    title: () => 'Dictado con IA',
    subtitle: () => S.vis ? `Visita del ${fmtFecha(S.vis.fecha)}` : '',
    html(){
      const D = S.dictado, P = D.propuesta;
      if (!P) return `<div class="stack">${aviso('info', 'mic', 'Contá con tus palabras cómo fue la visita. La IA lo ordena en tareas, observaciones y pendientes, y vos lo revisás antes de guardar.')}
        <div class="card"><label for="di_txt">Resumen de la visita</label><textarea id="di_txt" rows="8" placeholder="Ej.: hoy medimos la puesta a tierra, quedó pendiente el tablero del depósito…" ${oi('diTexto')}>${esc(D.texto)}</textarea>
          <button class="btn sec small" style="margin-top:10px" id="di_mic" ${on('diMic')}>${ic('mic')}Dictar</button></div></div>
        <div class="bottom-bar"><div class="actions"><button class="btn" ${on('diOrdenar')}>${ic('auto')}Ordenar con IA</button></div></div>`;
      return `<div class="stack">${aviso('aviso', 'info', 'Esto todavía no se guardó. Revisalo, corregí lo que haga falta y confirmá.')}
        <div class="card"><h4>Tareas realizadas</h4><p class="sub" style="margin-top:0">Una por línea.</p><textarea id="dp_tareas" rows="${Math.max(3, P.tareas_realizadas.length + 1)}">${esc(P.tareas_realizadas.join('\n'))}</textarea></div>
        <div class="card"><h4>Observaciones</h4><textarea id="dp_obs" rows="5">${esc(P.observaciones)}</textarea></div>
        <div class="card"><h4>Pendientes</h4><p class="sub" style="margin-top:0">Uno por línea.</p><textarea id="dp_pend" rows="${Math.max(3, P.pendientes.length + 1)}">${esc(P.pendientes.join('\n'))}</textarea></div></div>
        <div class="bottom-bar"><div class="actions"><button class="btn ghost" ${on('diDescartar')}>Volver a dictar</button><button class="btn" ${on('diConfirmar')}>${ic('check')}Confirmar y guardar</button></div></div>`;
    }
  };
  acciones.diTexto = t => { S.dictado.texto = t.value; };
  let recoIA = null;
  acciones.diMic = () => {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return avisar('Este navegador no permite dictar. Usá el micrófono del teclado del celular.');
    if (recoIA) { recoIA.stop(); return; }
    recoIA = new R();
    Object.assign(recoIA, {lang: 'es-AR', continuous: true, interimResults: false});
    recoIA.onresult = ev => {
      const ta = $('#di_txt');
      if (!ta) return;
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) ta.value = `${ta.value.trimEnd()} ${ev.results[i][0].transcript.trim()}.`.trimStart();
      S.dictado.texto = ta.value;
    };
    recoIA.onend = () => { recoIA = null; const b = $('#di_mic'); if (b) { b.innerHTML = ic('mic') + 'Dictar'; b.classList.remove('grabando'); } };
    recoIA.onerror = e => { if (e.error === 'not-allowed') avisar('Hay que permitir el micrófono para dictar.'); };
    recoIA.start();
    const b = $('#di_mic'); b.innerHTML = ic('stop') + 'Detener'; b.classList.add('grabando');
  };
  acciones.diOrdenar = async () => {
    const texto = S.dictado.texto.trim();
    if (texto.length < 10) return avisar('Contá un poco más cómo fue la visita.');
    if (!navigator.onLine) return avisar('Ordenar con IA necesita señal. Tu texto queda acá: probá cuando vuelva, o copialo en Observaciones.');
    recoIA?.stop();
    toast('Ordenando el dictado…');
    const {data, error: e} = await sb.functions.invoke('ordenar-dictado', {body: {texto, tareas: S.vis.tareas.map(t => t.nombre)}});
    if (e) {
      let cod = '';
      try { cod = (await e.context?.json?.())?.error || ''; } catch {}
      return avisar(cod === 'sin_clave' ? 'Todavía falta cargar la clave de Claude en el servidor. Tu texto no se perdió.' : `No se pudo ordenar el dictado: ${cod || e.message}. Tu texto no se perdió.`);
    }
    S.dictado.propuesta = data;
    render();
    scrollTo(0, 0);
  };
  acciones.diDescartar = () => { S.dictado.propuesta = null; render(); };
  acciones.diConfirmar = async () => {
    const lineas = id => $('#' + id).value.split('\n').map(x => x.trim()).filter(Boolean);
    const v = await getOne('visitas', S.vid), tareas = lineas('dp_tareas'), obs = $('#dp_obs').value.trim(), pend = lineas('dp_pend');
    for (const n of tareas) {
      const t = v.tareas.find(x => sinAcentos(x.nombre) === sinAcentos(n));
      if (t) t.hecha = true; else v.tareas.push({id: uid(), actividadId: '', nombre: n, hecha: true, prevista: false});
    }
    if (obs) v.observaciones = [v.observaciones?.trim(), obs].filter(Boolean).join('\n\n');
    await put('visitas', v);
    for (const texto of pend) await put('pendientes', {id: uid(), estabId: v.estabId, texto, fecha: v.fecha, visitaId: v.id, estado: 'Abierto'});
    toast('Guardado en la visita');
    go('visita');
  };

  // ===== Arranque =====
  async function init(){
    if (!HABILITADA) return;
    addEventListener('online', () => programar(1000));
    addEventListener('offline', refrescar);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') programar(500); else if (activo()) sincronizar(); });
    setInterval(() => programar(100), 2 * 60e3);
    // La librería se carga solo si ya hay una sesión guardada o si se vuelve de un mail de la cuenta
    let hay = /access_token|type=recovery/.test(location.hash);
    try { hay ||= Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token')); } catch {}
    if (!hay) return;
    try { await conectar(); programar(800); refrescar(); } catch (e) { console.warn('Sync', e); }
  }

  return {views, acciones, prev, init, anotar, activo, botonNube, directorHtml, sincronizar, habilitada: HABILITADA};
})();
