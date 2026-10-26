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
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
