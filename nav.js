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
