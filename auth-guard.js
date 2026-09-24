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
  var NAVMAP = { 'index.html':'tableros','productos.html':'productos','clientes.html':'clientes','stock.html':'stock','compras.html':'compras','remitos.html':'remitos','cuentas.html':'cuentas','caja.html':'caja','ventas.html':'ventas','configuracion.html':'configuracion','usuarios.html':'usuarios' };
  function mkPuede(esAdmin, permisos){ var set={}; (permisos||[]).forEach(function(p){ set[p]=true; }); return function(k){ return !!(esAdmin || set['*'] || set[k]); }; }
  async function applyGuard(){
    try{
      if(!window.sbClient || !window.sf) return;
      var s=await window.sbClient.auth.getSession(); if(!(s.data && s.data.session)) return;
      var r=await window.sf('getMiPerfil'); if(!r || !r.ok) return;
      window.PERM={ cargado:true, esAdmin:!!r.esAdmin, permisos:r.permisos||[], locales:r.locales||[], rol:r.rol, bootstrap:!!r.bootstrap, puede:mkPuede(r.esAdmin, r.permisos) };
      window.puede=function(k){ return window.PERM.puede(k); };
      filtrarNav();
      document.dispatchEvent(new Event('perm-listo'));
    }catch(e){ /* ante cualquier error no bloqueamos el uso */ }
  }
  function filtrarNav(){
    document.querySelectorAll('header nav a').forEach(function(a){
      var href=(a.getAttribute('href')||'').split('/').pop();
      var mod=NAVMAP[href]; if(!mod) return;
      if(!window.PERM.puede(mod)) a.style.display='none';
    });
  }
  window.puede=function(k){ return window.PERM.puede(k); };
  window.aplicarPermisos=applyGuard;
  document.addEventListener('DOMContentLoaded', function(){
    var app=document.getElementById('app');
    if(app){
      var obs=new MutationObserver(function(){ if(!app.hidden) applyGuard(); });
      obs.observe(app,{attributes:true, attributeFilter:['hidden']});
      if(!app.hidden) applyGuard();
    }
    // --- Recuperación de contraseña ---
    if(window.sbClient){
      try{ window.sbClient.auth.onAuthStateChange(function(ev){ if(ev==='PASSWORD_RECOVERY') overlayReset(); }); }catch(e){}
      if(/type=recovery/.test(location.hash||'')) setTimeout(overlayReset, 300);
    }
  });

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
