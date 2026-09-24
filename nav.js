/************************************************************************
 * nav.js — Menú lateral único para todo el sistema.
 * Se inyecta en cada página; finito por defecto, se expande al pasar el
 * mouse. Marca el módulo activo y trae data-perm para que auth-guard
 * oculte los que el rol no puede ver. Incluir después de sb-api.js.
 ************************************************************************/
(function(){
  var ITEMS=[
    ['index.html','📊','Tablero','tableros'],
    ['ventas.html','🛒','Ventas','ventas'],
    ['caja.html','💵','Caja','caja'],
    ['productos.html','🏷️','Productos','productos'],
    ['clientes.html','👥','Clientes y Listas','clientes'],
    ['stock.html','📦','Stock','stock'],
    ['compras.html','🧾','Compras','compras'],
    ['remitos.html','🔄','Remitos','remitos'],
    ['cuentas.html','📒','Cuentas','cuentas'],
    ['configuracion.html','⚙️','Configuración','configuracion'],
    ['usuarios.html','👤','Usuarios y roles','usuarios']
  ];
  var here=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  function build(){
    if(document.getElementById('sidenav')) return;
    var aside=document.createElement('aside'); aside.id='sidenav';
    aside.innerHTML='<div class="sn-logo" title="Carnicería">🥩</div>'+ITEMS.map(function(it){
      var on=(it[0].toLowerCase()===here)?' on':'';
      return '<a href="'+it[0]+'" class="sn-item'+on+'" data-perm="'+it[3]+'"><span class="sn-ico">'+it[1]+'</span><span class="sn-lbl">'+it[2]+'</span></a>';
    }).join('');
    document.body.appendChild(aside);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
