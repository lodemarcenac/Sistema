/************************************************************************
 * nav.js — Menú lateral único para todo el sistema.
 * Se inyecta en cada página; finito por defecto, se expande al pasar el
 * mouse. Marca el módulo activo y trae data-perm para que auth-guard
 * oculte los que el rol no puede ver. Incluir después de sb-api.js.
 ************************************************************************/
(function(){
  var ITEMS=[
    ['index.html','📊','Tablero','tableros'],
    ['reportes.html','📈','Reportes','reportes'],
    ['ventas.html','🛒','Ventas','ventas'],
    ['caja.html','💵','Caja','caja'],
    ['productos.html','🏷️','Productos','productos'],
    ['clientes.html','👥','Clientes y Listas','clientes'],
    ['stock.html','📦','Stock','stock'],
    ['compras.html','🧾','Compras y Gastos','compras'],
    ['remitos.html','🔄','Remitos internos','remitos'],
    ['cuentas.html','📒','Deudas a Pagar','cuentas'],
    ['conciliacion.html','💳','Conciliación Clover','conciliacion'],
    ['auditoria.html','🔎','Auditoría','auditoria'],
    ['configuracion.html','⚙️','Configuración','configuracion'],
    ['usuarios.html','👤','Usuarios y roles','usuarios']
  ];
  var here=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  // Versión de la página actual: se la pegamos a cada link del menú (?v=…) para
  // que navegar NO sirva un HTML viejo del caché. Al ir a una URL versionada el
  // navegador baja el HTML fresco; con una sola navegación la pantalla ya queda
  // en la versión actual (evita que el banner "Actualizar" reaparezca al navegar).
  var vq=(typeof window!=='undefined' && window.APP_BUILD) ? ('?v='+encodeURIComponent(window.APP_BUILD)) : '';

  // --- Botón "Instalar app": guardamos el evento del navegador y mostramos/ocultamos ---
  var deferredPrompt=null;
  function esStandalone(){ try{ return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone===true; }catch(e){ return false; } }
  function refreshInstall(){ var b=document.getElementById('sn-install'); if(!b) return; var isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent||''); b.style.display=((deferredPrompt || isIOS) && !esStandalone())?'flex':'none'; }
  window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); deferredPrompt=e; refreshInstall(); });
  window.addEventListener('appinstalled', function(){ deferredPrompt=null; refreshInstall(); });

  function build(){
    if(document.getElementById('sidenav')) return;
    var aside=document.createElement('aside'); aside.id='sidenav';
    aside.innerHTML='<div class="sn-logo" title="Carnicería">🥩</div>'+ITEMS.map(function(it){
      var on=(it[0].toLowerCase()===here)?' on':'';
      return '<a href="'+it[0]+vq+'" class="sn-item'+on+'" data-perm="'+it[3]+'"><span class="sn-ico">'+it[1]+'</span><span class="sn-lbl">'+it[2]+'</span></a>';
    }).join('');
    document.body.appendChild(aside);

    // --- Menú mobile: hamburguesa + cajón (solo actúa en pantalla chica, vía CSS) ---
    var burger=document.createElement('button'); burger.id='navburger'; burger.type='button';
    burger.setAttribute('aria-label','Menú'); burger.innerHTML='☰';
    var backdrop=document.createElement('div'); backdrop.id='navbackdrop';
    document.body.appendChild(burger); document.body.appendChild(backdrop);
    function abrir(){ aside.classList.add('open'); backdrop.classList.add('show'); }
    function cerrar(){ aside.classList.remove('open'); backdrop.classList.remove('show'); }
    burger.addEventListener('click', function(){ aside.classList.contains('open')?cerrar():abrir(); });
    backdrop.addEventListener('click', cerrar);
    aside.addEventListener('click', function(ev){ if(ev.target.closest('.sn-item')) cerrar(); });  // al elegir, cierra el cajón

    // Botón "Instalar app" dentro del menú (visible solo si se puede instalar o en iPhone)
    var inst=document.createElement('button'); inst.id='sn-install'; inst.type='button'; inst.className='sn-item';
    inst.style.cssText='display:none;width:100%;background:none;border:none;font:inherit;text-align:left;color:#9ee6b8;cursor:pointer;';
    inst.innerHTML='<span class="sn-ico">📲</span><span class="sn-lbl">Instalar app</span>';
    aside.appendChild(inst);
    inst.addEventListener('click', function(){
      if(deferredPrompt){ var dp=deferredPrompt; deferredPrompt=null; dp.prompt(); if(dp.userChoice){ dp.userChoice.catch(function(){}); } refreshInstall(); cerrar(); return; }
      alert('Para instalar la app:\n\n• iPhone (Safari): tocá Compartir y después "Agregar a inicio".\n• Android (Chrome): menú ⋮ y después "Instalar app".');
      cerrar();
    });
    refreshInstall();
  }

  // --- PWA: manifest + íconos + service worker (para instalar en el celular) ---
  function setupPWA(){
    try{
      var head=document.head||document.getElementsByTagName('head')[0]; if(!head) return;
      function meta(name,content){ var m=document.createElement('meta'); m.name=name; m.content=content; head.appendChild(m); }
      function link(rel,href,extra){ var l=document.createElement('link'); l.rel=rel; l.href=href; if(extra) Object.keys(extra).forEach(function(k){ l.setAttribute(k,extra[k]); }); head.appendChild(l); }
      if(!document.querySelector('link[rel="manifest"]')) link('manifest','manifest.json');
      if(!document.querySelector('meta[name="theme-color"]')) meta('theme-color','#0e2a5c');
      if(!document.querySelector('link[rel="apple-touch-icon"]')) link('apple-touch-icon','apple-touch-icon.png');
      meta('apple-mobile-web-app-capable','yes');
      meta('mobile-web-app-capable','yes');
      meta('apple-mobile-web-app-status-bar-style','black-translucent');
      meta('apple-mobile-web-app-title','Carnicería');
    }catch(e){}
    if('serviceWorker' in navigator){
      window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
    }
  }

  function init(){ build(); setupPWA(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
