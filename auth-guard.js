/************************************************************************
 * auth-guard.js — Permisos por rol en el cliente.
 * Carga el perfil del usuario logueado (getMiPerfil), expone window.PERM
 * y window.puede(key), y oculta del menú los módulos sin permiso.
 * Incluir en cada página DESPUÉS de sb-api.js.
 * Bootstrap: si no hay perfiles cargados, el usuario es admin (para poder
 * configurar Usuarios y roles la primera vez).
 ************************************************************************/
(function(){
  window.PERM = { cargado:false, esAdmin:false, permisos:[], locales:[], rol:null, puede:function(){ return true; } };
  // Evita el "parpadeo" del login al navegar: si ya hay sesión guardada, oculta el login de entrada.
  function _chk(st){ try{ for(var _i=0;_i<st.length;_i++){ if((st.key(_i)||'').indexOf('-auth-token')>=0) return true; } }catch(e){} return false; }
  var _haySesion=false; try{ _haySesion=_chk(window.sessionStorage)||_chk(window.localStorage); }catch(e){}
  if(_haySesion){ try{ var _st=document.createElement('style'); _st.id='hide-login-flash'; _st.textContent='#login{display:none!important;}'; (document.head||document.documentElement).appendChild(_st); }catch(e){} }
  var _selObs=null;
  // Tapa "Cargando…" mientras se resuelven los permisos → evita ver por un instante
  // una pantalla que no corresponde (ej. el Tablero a un usuario sin ese permiso).
  function ocultarContenido(){ if(document.getElementById('auth-cargando')) return; try{ var c=document.createElement('div'); c.id='auth-cargando'; c.style.cssText='position:fixed;inset:0;z-index:99998;background:#fff;display:flex;align-items:center;justify-content:center;color:#8891a3;font:14px system-ui,sans-serif;'; c.textContent='Cargando…'; (document.body||document.documentElement).appendChild(c); setTimeout(mostrarContenido,8000); }catch(e){} }
  function mostrarContenido(){ var c=document.getElementById('auth-cargando'); if(c&&c.parentNode) c.parentNode.removeChild(c); }
  function mostrarLogin(){ mostrarContenido(); var st=document.getElementById('hide-login-flash'); if(st) st.remove(); var lg=document.getElementById('login'); if(lg){ lg.hidden=false; lg.style.display=''; } }
  var NAVMAP = { 'index.html':'tableros','reportes.html':'reportes','productos.html':'productos','clientes.html':'clientes','stock.html':'stock','compras.html':'compras','remitos.html':'remitos','cuentas.html':'cuentas','conciliacion.html':'conciliacion','caja.html':'caja','ventas.html':'ventas','configuracion.html':'configuracion','usuarios.html':'usuarios' };
  function mkPuede(esAdmin, permisos){ var set={}; (permisos||[]).forEach(function(p){ set[p]=true; }); return function(k){ return !!(esAdmin || set['*'] || set[k]); }; }
  async function applyGuard(){
    try{
      if(!window.sbClient || !window.sf) return;
      if(_haySesion) ocultarContenido();
      var s=await window.sbClient.auth.getSession(); if(!(s.data && s.data.session)){ mostrarContenido(); return; }
      ocultarContenido();
      var r=await window.sf('getMiPerfil'); if(!r || !r.ok){ mostrarContenido(); return; }
      window.PERM={ cargado:true, esAdmin:!!r.esAdmin, permisos:r.permisos||[], locales:r.locales||[], rol:r.rol, nombre:r.nombre||'', usuario:r.usuario||'', email:r.email||'', bootstrap:!!r.bootstrap, puede:mkPuede(r.esAdmin, r.permisos) };
      window.puede=function(k){ return window.PERM.puede(k); };
      if(homeRedirect()) return;  // 1ª vez tras loguearse: manda a la pantalla de inicio según el rol (la tapa queda hasta cargar la otra página)
      if(guardPagina()) return;   // si no tiene permiso para esta página, redirige (no sigue)
      filtrarNav(); filtrarLocales();
      // Re-aplica el filtro del selector de local si la página rearma sus opciones (poblarSuc) después.
      if(!_selObs){ var _sel=document.getElementById('selSuc'); if(_sel && window.MutationObserver){ _selObs=new MutationObserver(function(){ filtrarLocales(); }); _selObs.observe(_sel,{childList:true}); } }
      document.dispatchEvent(new Event('perm-listo'));
      mostrarContenido();
    }catch(e){ mostrarContenido(); /* ante cualquier error no bloqueamos el uso */ }
  }
  // Al loguearse (una vez por sesión del navegador), lleva a la pantalla de inicio
  // según el rol: admin/encargado -> Reportes (Tablero del día); vendedor -> Ventas.
  function homeRedirect(){
    try{ if(sessionStorage.getItem('home-ok')) return false; }catch(e){ return false; }
    if(!window.PERM.cargado) return false;
    try{ sessionStorage.setItem('home-ok','1'); }catch(e){}
    var here=(location.pathname.split('/').pop()||'index.html').toLowerCase();
    var home = (window.PERM.esAdmin || window.PERM.puede('reportes')) ? 'reportes.html'
             : (window.PERM.puede('ventas') ? 'ventas.html' : null);
    if(home && home!==here){ location.replace(home); return true; }
    return false;
  }
  // Si el usuario no tiene permiso para el módulo de ESTA página, lo manda a la
  // primera que sí pueda ver (ej. un vendedor que cae en el Tablero -> Ventas).
  function guardPagina(){
    if(!window.PERM.cargado || window.PERM.esAdmin || window.PERM.bootstrap) return false;
    var here=(location.pathname.split('/').pop()||'index.html').toLowerCase();
    var mod=NAVMAP[here];
    if(!mod || window.PERM.puede(mod)) return false;   // página sin módulo, o permitida
    var orden=['ventas.html','caja.html','index.html','productos.html','clientes.html','stock.html','compras.html','remitos.html','cuentas.html','conciliacion.html','reportes.html','configuracion.html','usuarios.html'];
    for(var i=0;i<orden.length;i++){ var m=NAVMAP[orden[i]]; if(m && orden[i]!==here && window.PERM.puede(m)){ location.replace(orden[i]); return true; } }
    return false;   // no tiene ninguna página permitida: no redirige (evita loop)
  }
  function filtrarLocales(){
    if(!window.PERM.cargado || window.PERM.esAdmin) return;
    var locs=window.PERM.locales||[]; if(!locs.length) return;   // sin locales asignados = no se limita
    var sel=document.getElementById('selSuc'); if(!sel) return;
    var before=sel.value;   // valor que la página ya tomó en su variable sucActual
    Array.prototype.slice.call(sel.options).forEach(function(o){ if(!(locs.indexOf(o.value)>=0 || locs.indexOf(o.textContent)>=0)) o.remove(); });
    if(!sel.options.length) return;
    var vals=Array.prototype.slice.call(sel.options).map(function(o){ return o.value; });
    if(vals.indexOf(sel.value)<0) sel.value=sel.options[0].value;
    if(sel.options.length===1) sel.disabled=true;
    // Si el valor efectivo cambió (p.ej. localStorage tenía otro local, o el navegador
    // auto-seleccionó otra opción al quitar la elegida), sincronizar la página: actualizar
    // localStorage y disparar 'change' para que sucActual + datos queden en el local correcto.
    if(sel.value!==before){ try{ localStorage.setItem('pvSucursalPort', sel.value); }catch(e){} try{ sel.dispatchEvent(new Event('change')); }catch(e){} }
  }
  function filtrarNav(){
    document.querySelectorAll('#sidenav .sn-item[data-perm]').forEach(function(a){
      var mod=a.getAttribute('data-perm'); if(mod && !window.PERM.puede(mod)) a.style.display='none';
    });
    document.querySelectorAll('header nav a').forEach(function(a){
      var href=(a.getAttribute('href')||'').split('/').pop();
      var mod=NAVMAP[href]; if(!mod) return;
      if(!window.PERM.puede(mod)) a.style.display='none';
    });
  }
  window.puede=function(k){ return window.PERM.puede(k); };
  window.aplicarPermisos=applyGuard;
  // El login ahora es por NOMBRE DE USUARIO (los empleados no usan mail).
  // Relabela el campo de email en todas las páginas (el id li-email se mantiene)
  // y agrega el link "¿Olvidaste tu contraseña?" (solo sirve a quien tiene mail).
  function relabelLogin(){
    var inp=document.getElementById('li-email'); if(!inp) return;
    try{ inp.type='text'; }catch(e){}
    inp.setAttribute('autocomplete','username'); inp.removeAttribute('required');
    inp.placeholder='Usuario';
    var lab=inp.previousElementSibling;
    if(lab && lab.tagName==='LABEL') lab.textContent='Usuario';
    var form=document.getElementById('login-form');
    if(form && !document.getElementById('link-recuperar')){
      var a=document.createElement('a'); a.id='link-recuperar'; a.href='#'; a.textContent='¿Olvidaste tu contraseña?';
      a.style.cssText='display:block;margin-top:12px;font-size:.85rem;color:#1b4f8a;text-decoration:none;cursor:pointer;';
      a.addEventListener('click', function(e){ e.preventDefault(); recuperarClave(); });
      form.appendChild(a);
    }
  }
  async function recuperarClave(){
    var id=prompt('Ingresá tu usuario (o email) para recuperar la contraseña:');
    if(id===null) return; id=String(id).trim(); if(!id) return;
    var email=id;
    if(id.indexOf('@')<0){
      try{ var r=await window.sbClient.rpc('email_de_usuario',{ p_usuario:id }); email=(r && !r.error && r.data)?r.data:null; }catch(e){ email=null; }
    }
    if(!email){ alert('No encontramos ese usuario.'); return; }
    if(/@lodemarcenac\.local$/i.test(email)){ alert('Este usuario no tiene un email cargado para recuperar la clave.\nPedile al administrador que te la resetee.'); return; }
    try{
      var res=await window.sbClient.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if(res.error){ alert('No se pudo: '+res.error.message); return; }
      alert('Te enviamos un correo para restablecer la contraseña.\nRevisá tu casilla (y la carpeta de spam).');
    }catch(e){ alert('No se pudo: '+(e.message||e)); }
  }
  document.addEventListener('DOMContentLoaded', function(){
    relabelLogin();
    var app=document.getElementById('app');
    if(app){
      var obs=new MutationObserver(function(){ if(!app.hidden) applyGuard(); });
      obs.observe(app,{attributes:true, attributeFilter:['hidden']});
      if(!app.hidden) applyGuard();
    }
    // Si no hay sesión válida, mostrar el login (y sacar el ocultamiento anti-parpadeo)
    if(window.sbClient){
      try{ window.sbClient.auth.getSession().then(function(s){ if(!(s.data && s.data.session)) mostrarLogin(); }); }catch(e){ mostrarLogin(); }
    }
    // --- Recuperación de contraseña ---
    if(window.sbClient){
      try{ window.sbClient.auth.onAuthStateChange(function(ev){ if(ev==='PASSWORD_RECOVERY') overlayReset(); }); }catch(e){}
      if(/type=recovery/.test(location.hash||'')) setTimeout(overlayReset, 300);
    }
  });

  // --- Auto-actualización: detecta versión nueva publicada y ofrece recargar ---
  (function(){
    // Versión de ESTE código (debe coincidir con app/version.json en cada deploy).
    // Se compara contra la version.json del servidor: si difieren, el código que
    // está corriendo quedó viejo (aunque el navegador haya cacheado los archivos).
    var BUILD='2026-10-10.2';
    function check(){
      fetch('version.json?t='+Date.now(), {cache:'no-store'})
        .then(function(r){ return r.ok?r.json():null; })
        .then(function(j){ if(!j) return; var v=j.version||j.v; if(!v) return;
          if(v===BUILD){ try{ sessionStorage.removeItem('upd-tried'); }catch(e){} return; }
          banner(v); })
        .catch(function(){});
    }
    function banner(v){
      if(document.getElementById('upd-banner')) return;
      // ¿Ya intentamos actualizar a ESTA versión y el navegador sigue con el código viejo?
      // (típico: archivos cacheados). En ese caso no ofrecemos "Actualizar" de nuevo
      // —eso genera el bucle— sino que pedimos Ctrl+F5.
      var tried=null; try{ tried=sessionStorage.getItem('upd-tried'); }catch(e){}
      var b=document.createElement('div'); b.id='upd-banner';
      b.style.cssText='position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#0e2a5c;color:#fff;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.35);z-index:9998;font-family:Inter,system-ui,Arial,sans-serif;font-size:.85rem;display:flex;align-items:center;gap:12px;max-width:92vw;';
      if(tried===v){
        b.innerHTML='🔄 Para terminar de actualizar, apretá <b>Ctrl + F5</b> (o cerrá y volvé a abrir el navegador).';
      } else {
        b.innerHTML='🔄 Hay una versión nueva del sistema. <button id="upd-btn" style="background:#fff;color:#0e2a5c;border:none;padding:6px 12px;border-radius:7px;font-weight:700;cursor:pointer;font-family:inherit;">Actualizar</button>';
      }
      document.body.appendChild(b);
      var btn=document.getElementById('upd-btn');
      if(btn) btn.addEventListener('click', function(){ try{ sessionStorage.setItem('upd-tried', v); }catch(e){} location.reload(true); });
    }
    document.addEventListener('DOMContentLoaded', function(){
      check();
      setInterval(check, 180000);
      document.addEventListener('visibilitychange', function(){ if(!document.hidden) check(); });
    });
  })();

  function overlayReset(){
    if(document.getElementById('pw-reset')) return;
    var d=document.createElement('div'); d.id='pw-reset';
    d.style.cssText='position:fixed;inset:0;background:linear-gradient(160deg,#1257c4,#0d3f92);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;font-family:Inter,system-ui,Arial,sans-serif;';
    d.innerHTML='<div style="background:#fff;border-radius:14px;padding:30px 28px;width:100%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.3);">'+
      '<h1 style="font-size:1.35rem;color:#1257c4;margin:0 0 4px;">Nueva contraseña</h1>'+
      '<p style="font-size:.85rem;color:#7a8296;margin:0 0 16px;">Elegí una contraseña nueva para tu usuario.</p>'+
      '<input id="pw-new" type="password" placeholder="Nueva contraseña" style="width:100%;padding:11px 12px;border:1px solid #c7cede;border-radius:8px;font-size:.9rem;box-sizing:border-box;">'+
      '<input id="pw-new2" type="password" placeholder="Repetir contraseña" style="width:100%;margin-top:10px;padding:11px 12px;border:1px solid #c7cede;border-radius:8px;font-size:.9rem;box-sizing:border-box;">'+
      '<button id="pw-save" style="width:100%;margin-top:16px;padding:12px;background:#1257c4;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:.9rem;">Guardar contraseña</button>'+
      '<div id="pw-msg" style="font-size:.82rem;margin-top:12px;min-height:1em;"></div></div>';
    document.body.appendChild(d);
    document.getElementById('pw-save').addEventListener('click', async function(){
      var p1=document.getElementById('pw-new').value, p2=document.getElementById('pw-new2').value, msg=document.getElementById('pw-msg');
      if(p1.length<6){ msg.style.color='#c0392b'; msg.textContent='La contraseña debe tener al menos 6 caracteres.'; return; }
      if(p1!==p2){ msg.style.color='#c0392b'; msg.textContent='Las contraseñas no coinciden.'; return; }
      msg.style.color='#7a8296'; msg.textContent='Guardando…';
      var r=await window.sbClient.auth.updateUser({ password:p1 });
      if(r.error){ msg.style.color='#c0392b'; msg.textContent='Error: '+r.error.message; return; }
      msg.style.color='#2e7d4f'; msg.textContent='✓ Contraseña actualizada. Redirigiendo…';
      setTimeout(function(){ location.href=location.pathname; }, 1200);
    });
  }
})();
