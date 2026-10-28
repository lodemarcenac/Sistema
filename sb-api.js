/************************************************************************
 * sb-api.js — Adaptador de datos Supabase para el POS.
 * Reemplaza las funciones sf()/sp() que hoy llaman al Apps Script.
 * Devuelve las MISMAS formas de respuesta que el backend viejo, así el
 * resto del código de cada página funciona sin cambios.
 *
 * Incluir en cada página (hosteada) ANTES de su lógica:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="sb-api.js"></script>
 *
 * Estado: LECTURAS implementadas. Las ESCRITURAS (registrarVenta, remitos,
 * etc.) se van agregando como RPC de Supabase a medida que portamos cada
 * página (por ahora avisan "pendiente").
 ************************************************************************/
(function(){
  var SUPABASE_URL='https://wnrnnecqauzqvdopyuyr.supabase.co';
  var SUPABASE_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inducm5uZWNxYXV6cXZkb3B5dXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MzgzNTIsImV4cCI6MjEwNDExNDM1Mn0.OXajZCCXn2xcjxEP_qtDECnpaByCsbX1I7eUH0b5jw8';
  // Sesión en sessionStorage: sobrevive recargas y navegación, pero se cierra al
  // cerrar Chrome / reiniciar la PC (obliga a loguearse de nuevo). Pedido del usuario.
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  // --- Login por NOMBRE DE USUARIO ---------------------------------------
  // Los empleados entran con un usuario (no mail). Interceptamos el login: si
  // lo que tipearon NO tiene '@', lo tratamos como usuario y resolvemos su
  // email de cuenta con la función email_de_usuario. Si tiene '@', es email
  // directo (compatibilidad con los usuarios viejos). Transparente para todas
  // las páginas (no hace falta tocar el handler de cada una).
  async function resolverEmailUsuario(usuario){
    try{ var r=await sb.rpc('email_de_usuario',{ p_usuario:usuario }); if(!r.error && r.data) return r.data; }catch(e){}
    return null;
  }
  (function(){
    var _orig = sb.auth.signInWithPassword.bind(sb.auth);
    sb.auth.signInWithPassword = async function(creds){
      try{
        var id = (creds && creds.email!=null) ? String(creds.email).trim() : '';
        if(id && id.indexOf('@')<0){
          var em = await resolverEmailUsuario(id);
          if(em){ creds = Object.assign({}, creds, { email:em }); }
          else { return { data:{ user:null, session:null }, error:{ message:'Usuario o contraseña incorrectos' } }; }
        }
      }catch(e){}
      return _orig(creds);
    };
  })();
  window.sbClient = sb;

  function hoyISO(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}); }
  // Bordes de un rango de días en hora de Argentina (las fechas se guardan en UTC):
  // convierte 'YYYY-MM-DD' al instante correcto para comparar contra timestamptz.
  function desdeAR(d){ return d+'T00:00:00-03:00'; }
  function hastaAR(d){ return d+'T23:59:59-03:00'; }
  function parseAction(a){ // "getProductos&admin=1" -> {base, params:{admin:'1'}}
    var parts=String(a||'').split('&'); var base=parts.shift(); var params={};
    parts.forEach(function(p){ var kv=p.split('='); params[kv[0]]=decodeURIComponent(kv[1]||''); });
    return {base:base, params:params};
  }

  // ---------------- LECTURAS ----------------
  var readers = {
    ping: async function(){ return {ok:true, msg:'ok'}; },

    getProductos: async function(params){
      var q = sb.from('productos').select('id,codigo_interno,nombre,marca,descripcion,tipo,costo,stock_minimo,margen_override,activo,fecha_costo,categoria:categorias(nombre),precios:producto_precios(precio,fecha,lista:listas_precio(nombre))');
      var res = await q; if(res.error) throw res.error;
      var admin = params && params.admin==='1';
      var out={};
      (res.data||[]).forEach(function(p){
        if(!admin && p.activo===false) return;
        var precio={}, fechas={};
        (p.precios||[]).forEach(function(pp){ var ln=pp.lista?pp.lista.nombre:null; if(ln){ precio[ln]=Number(pp.precio); if(pp.fecha) fechas[ln.toLowerCase()]=pp.fecha; } });
        if(p.fecha_costo) fechas.costo=p.fecha_costo;
        out[p.codigo_interno]={ nombre:p.nombre, marca:p.marca||'', descripcion:p.descripcion||'', categoria:p.categoria?p.categoria.nombre:'',
          tipo:p.tipo||'pesable', costo:(p.costo==null?null:Number(p.costo)), precio:precio,
          margenOverride:(p.margen_override==null?null:Number(p.margen_override)), stockMinimo:(p.stock_minimo==null?null:Number(p.stock_minimo)),
          fechas:fechas, activo:p.activo!==false };
      });
      return {ok:true, productos:out};
    },

    getClientes: async function(){
      var res = await sb.from('clientes').select('id,legacy_id,nombre,activo,lista:listas_precio(nombre),adm:sucursales(nombre)');
      if(res.error) throw res.error;
      return {ok:true, clientes:(res.data||[]).filter(function(c){ return c.activo!==false; }).map(function(c){ return { id:(c.legacy_id||String(c.id)), realId:c.id, nombre:c.nombre, lista:c.lista?c.lista.nombre:'', administrador:c.adm?c.adm.nombre:'' }; })};
    },

    getListas: async function(){
      var res = await sb.from('listas_precio').select('nombre,tipo,relacion_pct'); if(res.error) throw res.error;
      return {ok:true, listas:(res.data||[]).map(function(l){ return { nombre:l.nombre, tipo:(l.tipo||'especial'), relacion:Number(l.relacion_pct)||0 }; })};
    },

    getCategorias: async function(){
      var res = await sb.from('categorias').select('nombre'); if(res.error) throw res.error;
      return {ok:true, categorias:(res.data||[]).map(function(c){ return c.nombre; })};
    },

    getCategoriasFull: async function(){
      var r=await sb.from('categorias').select('nombre,margen_pct,plus_remito_pct').order('nombre');
      if(r.error) throw r.error;
      return {ok:true, categorias:(r.data||[]).map(function(c){ return { nombre:c.nombre, margen:(c.margen_pct==null?'':Number(c.margen_pct)), plusRemito:(c.plus_remito_pct==null?'':Number(c.plus_remito_pct)) }; })};
    },

    getMargenesCategorias: async function(){
      var res = await sb.from('categorias').select('nombre,margen_pct,plus_remito_pct'); if(res.error) throw res.error;
      var m={}, mr={}; (res.data||[]).forEach(function(c){ if(c.margen_pct!=null) m[c.nombre]=Number(c.margen_pct); if(c.plus_remito_pct!=null) mr[c.nombre]=Number(c.plus_remito_pct); });
      return {ok:true, margenes:m, margenesRemito:mr};
    },

    getDestinatarios: async function(){
      var res = await sb.from('sucursales').select('nombre,sigla,activo'); if(res.error) throw res.error;
      var dests=[], siglas={}; (res.data||[]).forEach(function(s){ if(s.activo===false) return; dests.push(s.nombre); if(s.sigla) siglas[s.nombre]=s.sigla; });
      return {ok:true, destinatarios:dests, siglas:siglas};
    },

    getConfigGeneral: async function(){
      var res = await sb.from('config_general').select('clave,valor'); if(res.error) throw res.error;
      var cfg={}; (res.data||[]).forEach(function(r){ cfg[r.clave]=r.valor; });
      cfg.tiene_clave_autorizacion = !!cfg.clave_autorizacion; delete cfg.clave_autorizacion;
      return {ok:true, config:cfg};
    },

    getOfertas: async function(){
      var res = await sb.from('ofertas').select('precio_oferta,tipo,kilaje_minimo,kilaje_maximo,forma_pago,fecha_desde,fecha_hasta,activa,locales,prod:productos(codigo_interno,nombre)');
      if(res.error) throw res.error; var hoy=hoyISO();
      return {ok:true, ofertas:(res.data||[]).filter(function(o){return o.activa!==false;}).map(function(o){
        return { cod:o.prod?o.prod.codigo_interno:'', precioOferta:Number(o.precio_oferta), kilajeMinimo:Number(o.kilaje_minimo)||0, kilajeMaximo:Number(o.kilaje_maximo)||0, formaPago:o.forma_pago||'',
          tipo:o.tipo||'', nombre:o.prod?o.prod.nombre:'', locales:o.locales||'todos',
          desde:o.fecha_desde||'', hasta:o.fecha_hasta||'', vigente:(!o.fecha_desde||hoy>=o.fecha_desde)&&(!o.fecha_hasta||hoy<=o.fecha_hasta) };
      })};
    },

    getCombos: async function(){
      var res = await sb.from('combos').select('id,nombre,activo,locales,tipo,precio_cerrado,comp:combo_componentes(minimo,precio_promo,peso_unitario,prod:productos(codigo_interno,nombre,tipo))');
      if(res.error) throw res.error;
      return {ok:true, combos:(res.data||[]).filter(function(c){return c.activo!==false;}).map(function(c){
        return { id:c.id, nombre:c.nombre, locales:c.locales||'todos', tipo:c.tipo||'promo', precioCerrado:(c.precio_cerrado==null?0:Number(c.precio_cerrado)),
          componentes:(c.comp||[]).map(function(k){ return { codigo:k.prod?k.prod.codigo_interno:'', nombreProd:(k.prod?k.prod.nombre:''), tipoProd:(k.prod?k.prod.tipo:'pesable'), minimo:Number(k.minimo)||0, precioPromo:Number(k.precio_promo)||0, pesoUnitario:(k.peso_unitario==null?'':Number(k.peso_unitario)) }; }) };
      })};
    },

    getSaldoCliente: async function(params){
      var id=params&&params.id; if(!id) return {ok:true, saldo:0};
      var r=await sb.from('cuenta_corriente').select('tipo,monto').eq('cliente_id',id);
      if(r.error) throw r.error;
      var s=0; (r.data||[]).forEach(function(m){ var v=Number(m.monto)||0; if(/pago/i.test(m.tipo)) s-=v; else s+=v; });
      return {ok:true, saldo:s};   // saldo>0 = el cliente debe
    },

    getVentas: async function(params){
      params=params||{};
      var q=sb.from('ventas').select('id,comprobante,fecha,cliente_nombre,total,forma_pago,estado,sucursal:sucursales(nombre)').order('fecha',{ascending:false});
      if(params.sucursal){ var m=await sucIdMap(); var sid=m[params.sucursal]; if(sid) q=q.eq('sucursal_id',sid); }
      if(params.desde) q=q.gte('fecha', desdeAR(params.desde));
      if(params.hasta) q=q.lte('fecha', hastaAR(params.hasta));
      q=q.limit(params.limit?parseInt(params.limit):50);
      var res=await q; if(res.error) throw res.error;
      var arr=(res.data||[]).map(function(v){ return { id:v.id, comprobante:v.comprobante, fecha:v.fecha, cliente:v.cliente_nombre, total:Number(v.total), formaPago:v.forma_pago, estado:v.estado, sucursal:v.sucursal?v.sucursal.nombre:'' }; });
      if(params.q){ var qq=String(params.q).toLowerCase(); arr=arr.filter(function(v){ return (v.comprobante+' '+(v.cliente||'')+' '+(v.formaPago||'')).toLowerCase().indexOf(qq)>=0; }); }
      return {ok:true, ventas:arr};
    },
    getVentaDetalle: async function(params){
      var id=params&&params.id; if(!id) throw new Error('Falta id de venta');
      var v=await sb.from('ventas').select('*,sucursal:sucursales(nombre,direccion,telefono,sigla)').eq('id',id).single(); if(v.error) throw v.error;
      var d=await sb.from('ventas_detalle').select('*').eq('venta_id',id); if(d.error) throw d.error;
      var pg=await sb.from('pagos').select('*').eq('venta_id',id); if(pg.error) throw pg.error;
      return {ok:true, venta:v.data, detalle:d.data||[], pagos:pg.data||[]};
    },
    // Detalle renglón por renglón (por kg) de todas las ventas de un local entre fechas.
    // Para exportar. params: sucursal(nombre, opcional=todos), desde, hasta, excluirAnuladas('1').
    getVentasDetalle: async function(params){
      params=params||{};
      // Agregación en el servidor (jsonb) para no chocar con el límite de filas
      // de PostgREST: el select crudo con .limit() truncaba y perdía las ventas
      // más recientes (las de hoy). Filtro por día en hora de Argentina.
      var sid=null;
      if(params.sucursal){ var m=await sucIdMap(); sid=m[params.sucursal]||null; }
      var r=await sb.rpc('reporte_ventas_detalle', {
        p_desde: params.desde||null,
        p_hasta: params.hasta||null,
        p_suc: sid,
        p_excluir_anuladas: params.excluirAnuladas==='1'
      });
      if(r.error) throw r.error;
      var rows=(r.data||[]).map(function(d){ return {
        fecha:d.fecha, comprobante:d.comprobante, cliente:d.cliente||'', formaPago:d.forma_pago||'', estado:d.estado||'',
        local:d.local||'', categoria:d.categoria||'', codigo:d.codigo||'', producto:d.producto||'', marca:d.marca||'',
        pesoKg:(d.peso==null?'':Number(d.peso)), precioKg:(d.precio_kg==null?'':Number(d.precio_kg)),
        cantidad:(d.cantidad==null?'':Number(d.cantidad)), importe:(d.precio==null?'':Number(d.precio)),
        descuentoPct:(d.descuento_pct==null?'':Number(d.descuento_pct)) }; });
      return {ok:true, filas:rows};
    },
    getRoles: async function(){
      var r=await sb.from('roles').select('id,nombre,activo').order('id'); if(r.error) throw r.error;
      var rp=await sb.from('rol_permisos').select('rol_id,permiso'); var byRol={}; (rp.data||[]).forEach(function(x){ (byRol[x.rol_id]=byRol[x.rol_id]||[]).push(x.permiso); });
      return {ok:true, roles:(r.data||[]).filter(function(x){return x.activo!==false;}).map(function(x){ return { id:x.id, nombre:x.nombre, permisos:byRol[x.id]||[] }; })};
    },
    getPerfiles: async function(){
      var r=await sb.from('perfiles').select('id,email,usuario,nombre,activo,rol_id,usuario_id,rol:roles(nombre)').order('usuario'); if(r.error) throw r.error;
      var ul=await sb.from('usuario_locales').select('perfil_id,sucursal_id'); var byP={}; (ul.data||[]).forEach(function(x){ (byP[x.perfil_id]=byP[x.perfil_id]||[]).push(x.sucursal_id); });
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      return {ok:true, perfiles:(r.data||[]).filter(function(p){return p.activo!==false;}).map(function(p){ return { id:p.id, email:p.email, usuario:p.usuario||'', usuarioId:p.usuario_id||null, nombre:p.nombre||'', rolId:p.rol_id, rol:(p.rol?p.rol.nombre:''), locales:(byP[p.id]||[]).map(function(id){return idToName[id]||id;}), localesIds:(byP[p.id]||[]) }; })};
    },
    getMiPerfil: async function(){
      var u=await sb.auth.getUser(); var email=(u.data&&u.data.user&&u.data.user.email)||null;
      var cnt=await sb.from('perfiles').select('id',{count:'exact',head:true}); if(cnt.error) throw cnt.error;
      if((cnt.count||0)===0) return {ok:true, bootstrap:true, esAdmin:true, permisos:['*'], locales:[], rol:'Administrador (inicial)', email:email};
      if(!email) return {ok:true, esAdmin:false, permisos:[], locales:[], rol:null, email:null};
      var pr=await sb.from('perfiles').select('id,nombre,usuario,activo,rol_id,rol:roles(nombre)').eq('email',email).maybeSingle(); if(pr.error) throw pr.error;
      var perfil=pr.data;
      if(!perfil || perfil.activo===false) return {ok:true, esAdmin:false, permisos:[], locales:[], rol:null, email:email, sinPerfil:true};
      var permisos=[]; if(perfil.rol_id){ var rp=await sb.from('rol_permisos').select('permiso').eq('rol_id',perfil.rol_id); permisos=(rp.data||[]).map(function(x){return x.permiso;}); }
      var locs=await sb.from('usuario_locales').select('sucursal_id').eq('perfil_id',perfil.id);
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      var locales=(locs.data||[]).map(function(x){ return idToName[x.sucursal_id]||x.sucursal_id; });
      return {ok:true, esAdmin:(permisos.indexOf('*')>=0), permisos:permisos, locales:locales, rol:(perfil.rol?perfil.rol.nombre:null), nombre:perfil.nombre, usuario:(perfil.usuario||''), email:email};
    },
    getProveedores: async function(){
      var r=await sb.from('proveedores').select('id,nombre,cuit,email,telefono,activo').order('nombre'); if(r.error) throw r.error;
      return {ok:true, proveedores:(r.data||[]).filter(function(p){return p.activo!==false;}).map(function(p){ return { id:p.id, nombre:p.nombre, cuit:p.cuit||'', email:p.email||'', telefono:p.telefono||'' }; })};
    },
    getGastos: async function(params){
      var q=sb.from('gastos').select('id,fecha,monto,descripcion,forma_pago,comprobante,sucursal_id,destinatario_id,categoria_gasto_id,proveedor_id,usuario_id,cat:categorias_gasto(nombre,grupo),prov:proveedores(nombre)').order('fecha',{ascending:false});
      if(params&&params.sucursal){ var m=await sucIdMap(); var sid=m[params.sucursal]; if(sid) q=q.or('sucursal_id.eq.'+sid+',destinatario_id.eq.'+sid); }
      q=q.limit(params&&params.limit?parseInt(params.limit):300);
      var r=await q; if(r.error) throw r.error;
      var pmG=await perfilNombres();
      return {ok:true, gastos:(r.data||[]).map(function(g){ return { id:g.id, fecha:g.fecha, monto:Number(g.monto)||0, descripcion:g.descripcion||'', formaPago:g.forma_pago||'', comprobante:g.comprobante||'', sucursalId:g.sucursal_id, destinatarioId:g.destinatario_id, categoriaId:g.categoria_gasto_id, proveedorId:g.proveedor_id, categoria:g.cat?g.cat.nombre:'', grupo:g.cat?g.cat.grupo:'', proveedor:g.prov?g.prov.nombre:'', cargadoPor:nombreUsuario(pmG,g.usuario_id) }; })};
    },
    getSaldosClientes: async function(){
      var cc=await sb.from('cuenta_corriente').select('cliente_id,tipo,monto'); if(cc.error) throw cc.error;
      var saldo={}; (cc.data||[]).forEach(function(x){ if(x.cliente_id==null) return; var v=Number(x.monto)||0; saldo[x.cliente_id]=(saldo[x.cliente_id]||0)+(/pago/i.test(x.tipo)?-v:v); });
      var ids=Object.keys(saldo); if(!ids.length) return {ok:true, clientes:[]};
      var cl=await sb.from('clientes').select('id,nombre').in('id',ids); if(cl.error) throw cl.error;
      var nom={}; (cl.data||[]).forEach(function(c){ nom[c.id]=c.nombre; });
      var arr=ids.map(function(id){ return { clienteId:Number(id), nombre:nom[id]||('#'+id), saldo:+(saldo[id]).toFixed(2) }; });
      arr.sort(function(a,b){ return b.saldo-a.saldo; });
      return {ok:true, clientes:arr};
    },
    getMovimientosCC: async function(params){
      var id=params&&params.id; if(!id) return {ok:true, movimientos:[], saldo:0};
      var r=await sb.from('cuenta_corriente').select('*').eq('cliente_id',id).order('fecha'); if(r.error) throw r.error;
      var idToName={}; try{ var sn=await sb.from('sucursales').select('id,nombre'); (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; }); }catch(e){}
      var saldo=0; var movs=(r.data||[]).map(function(m){ var v=Number(m.monto)||0; if(/pago/i.test(m.tipo)) saldo-=v; else saldo+=v; return { fecha:m.fecha, tipo:m.tipo, monto:v, concepto:m.concepto||'', comprobante:m.comprobante||'', formaPago:m.forma_pago||'', sucursalId:m.sucursal_id||null, sucursal:(m.sucursal_id?idToName[m.sucursal_id]||'':''), ref:m.ref||'', observaciones:(m.observaciones||''), saldo:saldo }; });
      return {ok:true, movimientos:movs, saldo:saldo};
    },
    // Detalle de una venta a partir de su comprobante (SIGLA-AAAAMMDD-NNNN).
    // Se usa en la cuenta corriente para ver/expandir qué compone cada venta a cta cte.
    getVentaDetallePorComprobante: async function(params){
      var comp=params&&params.comprobante; if(!comp) throw new Error('Falta comprobante');
      var v=await sb.from('ventas').select('*,sucursal:sucursales(nombre,direccion,telefono,sigla)').eq('comprobante',comp).order('id',{ascending:false}).limit(1).maybeSingle();
      if(v.error) throw v.error;
      if(!v.data) return {ok:false, error:'No se encontró la venta '+comp};
      var id=v.data.id;
      var d=await sb.from('ventas_detalle').select('*').eq('venta_id',id); if(d.error) throw d.error;
      var pg=await sb.from('pagos').select('*').eq('venta_id',id); if(pg.error) throw pg.error;
      return {ok:true, venta:v.data, detalle:d.data||[], pagos:pg.data||[]};
    },
    getMovProveedor: async function(params){
      var id=params&&params.id; if(!id) return {ok:true, movimientos:[], saldo:0};
      // Alcance de locales: 'sucursales' (lista, para cuentas juntas) o 'sucursal' (uno). Sin nada = todos.
      var sids=null, filtrado=false;
      if(params&&params.sucursales){ var mm=await sucIdMap(); filtrado=true; sids=String(params.sucursales).split(',').map(function(s){return s.trim();}).filter(Boolean).map(function(n){return mm[n];}).filter(function(x){return x!=null;}); }
      else if(params&&params.sucursal){ var m1=await sucIdMap(); filtrado=true; var one=m1[params.sucursal]; sids=one?[one]:[]; }
      if(filtrado && (!sids||!sids.length)) return {ok:true, movimientos:[], saldo:0};
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      var pmP=await perfilNombres();
      var q=sb.from('deuda_proveedores').select('*').eq('proveedor_id',id);
      if(filtrado) q=q.in('sucursal_id',sids);
      var r=await q.order('fecha'); if(r.error) throw r.error;
      var saldo=0; var movs=(r.data||[]).map(function(m){ var v=Number(m.monto)||0; if(/pago/i.test(m.tipo)) saldo-=v; else saldo+=v; return { id:m.id, fecha:m.fecha, tipo:m.tipo, monto:v, descripcion:m.descripcion||'', comprobante:m.comprobante||'', formaPago:m.forma_pago||'', local:idToName[m.sucursal_id]||'', cargadoPor:nombreUsuario(pmP,m.usuario_id), observaciones:(m.observaciones||''), saldo:saldo }; });
      return {ok:true, movimientos:movs, saldo:saldo};
    },
    getProveedoresDeLocal: async function(params){
      var m=await sucIdMap(); var names=null;
      if(params){ if(params.sucursales) names=String(params.sucursales).split(',').map(function(s){return s.trim();}).filter(Boolean); else if(params.sucursal) names=[params.sucursal]; }
      if(!names||!names.length) return {ok:true, proveedores:[]};
      var sids=names.map(function(n){return m[n];}).filter(function(x){return x!=null;}); if(!sids.length) return {ok:true, proveedores:[]};
      var pl=await sb.from('proveedor_locales').select('proveedor_id').in('sucursal_id',sids); if(pl.error) throw pl.error;
      var seen={}, ids=[]; (pl.data||[]).forEach(function(x){ if(!seen[x.proveedor_id]){ seen[x.proveedor_id]=true; ids.push(x.proveedor_id); } }); if(!ids.length) return {ok:true, proveedores:[]};
      var pr=await sb.from('proveedores').select('id,nombre,activo').in('id',ids).order('nombre'); if(pr.error) throw pr.error;
      return {ok:true, proveedores:(pr.data||[]).filter(function(p){return p.activo!==false;}).map(function(p){ return { id:p.id, nombre:p.nombre }; })};
    },
    getProveedorLocales: async function(params){
      var id=params&&params.id; if(!id) return {ok:true, locales:[]};
      var pl=await sb.from('proveedor_locales').select('sucursal_id').eq('proveedor_id',id); if(pl.error) throw pl.error;
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      return {ok:true, locales:(pl.data||[]).map(function(x){ return idToName[x.sucursal_id]||String(x.sucursal_id); })};
    },
    getProveedoresConLocales: async function(){
      var pr=await sb.from('proveedores').select('id,nombre,activo').order('nombre'); if(pr.error) throw pr.error;
      var pl=await sb.from('proveedor_locales').select('proveedor_id,sucursal_id');
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      var byProv={}; (pl.data||[]).forEach(function(x){ (byProv[x.proveedor_id]=byProv[x.proveedor_id]||[]).push(idToName[x.sucursal_id]||String(x.sucursal_id)); });
      return {ok:true, proveedores:(pr.data||[]).filter(function(p){return p.activo!==false;}).map(function(p){ return { id:p.id, nombre:p.nombre, locales:byProv[p.id]||[] }; })};
    },
    getRemitos: async function(params){
      var q=sb.from('remitos_internos').select('id,numero,origen_id,destino_id,estado,concepto,total_costo,fecha_emision,fecha_recepcion,usuario_id,recibido_por').order('fecha_emision',{ascending:false}).limit(300);
      var names=null;
      if(params){
        if(params.sucursales) names=String(params.sucursales).split(',').map(function(s){return s.trim();}).filter(Boolean);
        else if(params.sucursal) names=[params.sucursal];
      }
      if(names && names.length){
        var m=await sucIdMap(); var ids=names.map(function(n){return m[n];}).filter(function(x){return x!=null;});
        if(ids.length){ var list='('+ids.join(',')+')'; q=q.or('origen_id.in.'+list+',destino_id.in.'+list); }
      }
      var r=await q;
      if(r.error) throw r.error;
      var pm=await perfilNombres();
      return {ok:true, remitos:(r.data||[]).map(function(x){ return { id:x.id, numero:x.numero, origenId:x.origen_id, destinoId:x.destino_id, estado:x.estado, concepto:x.concepto||'', total:Number(x.total_costo)||0, emision:x.fecha_emision, recepcion:x.fecha_recepcion, creadoPor:nombreUsuario(pm,x.usuario_id), recibidoPor:nombreUsuario(pm,x.recibido_por) }; })};
    },
    // AUDITORÍA: listado unificado de eventos (compras, gastos, remitos, stock, caja, ventas).
    getAuditoria: async function(params){
      params=params||{};
      var p={};
      if(params.desde) p.desde=desdeAR(params.desde);
      if(params.hasta) p.hasta=hastaAR(params.hasta);
      if(params.sucursal){ var m=await sucIdMap(); var sid=m[params.sucursal]; if(sid) p.sucursal_id=sid; }
      if(params.usuarioId) p.usuario_id=params.usuarioId;
      if(params.operaciones){ p.operaciones=String(params.operaciones).split(',').map(function(s){return s.trim();}).filter(Boolean); }
      if(params.limit) p.limit=parseInt(params.limit);
      var r=await sb.rpc('auditoria_eventos',{ p:p }); if(r.error) throw r.error;
      var pm=await perfilNombres();
      var idN={}; try{ var sn=await sb.from('sucursales').select('id,nombre'); (sn.data||[]).forEach(function(s){ idN[s.id]=s.nombre; }); }catch(e){}
      return {ok:true, eventos:(r.data||[]).map(function(x){ return { fecha:x.fecha, operacion:x.operacion, accion:x.accion, local:(idN[x.sucursal_id]||''), usuario:nombreUsuario(pm,x.usuario_id), detalle:x.detalle||'', monto:(x.monto==null?null:Number(x.monto)), cantidad:(x.cantidad==null?null:Number(x.cantidad)), ref:x.ref||'' }; })};
    },
    getRemitoDetalle: async function(params){
      var id=params&&params.id; if(!id) throw new Error('Falta remito');
      var d=await sb.from('remitos_detalle').select('id,nombre,cantidad_emitida,cantidad_recibida,costo_unit,plus_pct,precio_remito_unit,categoria,disposicion,producto:productos(tipo,codigo_interno)').eq('remito_id',id).order('id'); if(d.error) throw d.error;
      return {ok:true, detalle:(d.data||[]).map(function(x){ return { id:x.id, nombre:x.nombre, cantidad:Number(x.cantidad_emitida)||0, recibida:x.cantidad_recibida, costo:Number(x.costo_unit)||0, plus:Number(x.plus_pct)||0, precio:Number(x.precio_remito_unit)||0, categoria:x.categoria||'', disposicion:x.disposicion||'', tipo:(x.producto?x.producto.tipo:''), codigo:(x.producto?x.producto.codigo_interno:'') }; })};
    },
    getCuentasProveedor: async function(){
      var pr=await sb.from('proveedores').select('id,nombre,activo').order('nombre'); if(pr.error) throw pr.error;
      var cu=await sb.from('proveedor_cuentas').select('id,proveedor_id,nombre,activo');
      var cl=await sb.from('proveedor_cuenta_locales').select('cuenta_id,sucursal_id');
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      var byCuenta={}; (cl.data||[]).forEach(function(x){ (byCuenta[x.cuenta_id]=byCuenta[x.cuenta_id]||[]).push(idToName[x.sucursal_id]||x.sucursal_id); });
      var byProv={}; (cu.data||[]).filter(function(c){return c.activo!==false;}).forEach(function(c){ (byProv[c.proveedor_id]=byProv[c.proveedor_id]||[]).push({ id:c.id, nombre:c.nombre||'', locales:byCuenta[c.id]||[] }); });
      return {ok:true, proveedores:(pr.data||[]).filter(function(p){return p.activo!==false;}).map(function(p){ return { id:p.id, nombre:p.nombre, cuentas:byProv[p.id]||[] }; })};
    },
    getCuentasDeLocal: async function(params){
      var m=await sucIdMap(); var sid=params&&params.sucursal?m[params.sucursal]:null; if(!sid) return {ok:true, cuentas:[]};
      var cl=await sb.from('proveedor_cuenta_locales').select('cuenta_id').eq('sucursal_id',sid);
      var ids=(cl.data||[]).map(function(x){return x.cuenta_id;}); if(!ids.length) return {ok:true, cuentas:[]};
      var cu=await sb.from('proveedor_cuentas').select('id,nombre,activo,prov:proveedores(id,nombre)').in('id',ids);
      return {ok:true, cuentas:(cu.data||[]).filter(function(c){return c.activo!==false;}).map(function(c){ return { id:c.id, nombre:c.nombre||'', proveedorId:(c.prov?c.prov.id:null), proveedor:(c.prov?c.prov.nombre:'') }; })};
    },
    getDeudasLocal: async function(params){
      var m=await sucIdMap(); var sid=params&&params.sucursal?m[params.sucursal]:null; if(!sid) return {ok:true, deudas:[]};
      var idToName={}; Object.keys(m).forEach(function(n){ idToName[m[n]]=n; });
      // Saldo consolidado por ASIGNACIÓN (reemplaza las "cuentas juntas"): un proveedor
      // comparte el saldo entre TODOS los locales a los que está asignado (proveedor_locales).
      // Si está asignado a uno solo, el saldo es el de ese local; si lo comparten dos o más,
      // se muestra el saldo conjunto, igual en cada uno de esos locales.
      var asignAll=await sb.from('proveedor_locales').select('proveedor_id,sucursal_id'); if(asignAll.error) throw asignAll.error;
      var locsByProv={};  // proveedor_id -> [sucursal_id...] asignados
      (asignAll.data||[]).forEach(function(x){ (locsByProv[x.proveedor_id]=locsByProv[x.proveedor_id]||[]).push(x.sucursal_id); });
      // Proveedores relevantes para ESTE local: asignados a él + con deuda cargada en él.
      var idsSet={};
      Object.keys(locsByProv).forEach(function(pid){ if(locsByProv[pid].indexOf(sid)>=0) idsSet[pid]=true; });
      var dps=await sb.from('deuda_proveedores').select('proveedor_id').eq('sucursal_id',sid); (dps.data||[]).forEach(function(x){ if(x.proveedor_id!=null) idsSet[x.proveedor_id]=true; });
      var relIds=Object.keys(idsSet).map(Number); if(!relIds.length) return {ok:true, deudas:[]};
      // Alcance por proveedor = locales asignados ∪ este local (lo de acá siempre cuenta).
      var scopeByProv={}, allScope={};
      relIds.forEach(function(pid){ var sc=(locsByProv[pid]||[]).slice(); if(sc.indexOf(sid)<0) sc.push(sid); scopeByProv[pid]=sc; sc.forEach(function(s){ allScope[s]=true; }); });
      var scopeIds=Object.keys(allScope).map(Number);
      // Saldo = suma de cargos - pagos sobre el alcance de cada proveedor
      var saldo={};
      var dp=await sb.from('deuda_proveedores').select('proveedor_id,sucursal_id,tipo,monto').in('proveedor_id',relIds).in('sucursal_id',scopeIds);
      (dp.data||[]).forEach(function(x){ if(x.proveedor_id==null) return; var sc=scopeByProv[x.proveedor_id]; if(!sc || sc.indexOf(x.sucursal_id)<0) return; var v=Number(x.monto)||0; saldo[x.proveedor_id]=(saldo[x.proveedor_id]||0)+(/pago/i.test(x.tipo)?-v:v); });
      var pr=await sb.from('proveedores').select('id,nombre,activo').in('id',relIds);
      return {ok:true, deudas:(pr.data||[]).filter(function(p){return p.activo!==false;}).map(function(p){
        var scopeNames=(scopeByProv[p.id]||[]).map(function(s){ return idToName[s]||String(s); });
        var compartido=scopeNames.length>1;
        return { proveedorId:p.id, proveedor:p.nombre, saldo:+((saldo[p.id]||0)).toFixed(2), junta:compartido, localesJunta:(compartido?scopeNames:[]), scope:scopeNames };
      }).sort(function(a,b){ return b.saldo-a.saldo; })};
    },
    // Vista del administrador: deuda de TODOS los locales, un renglón por proveedor
    // con el saldo total y los locales donde opera. Solo lectura (para pagar, se entra al local).
    getDeudasTodas: async function(){
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      var asign=await sb.from('proveedor_locales').select('proveedor_id,sucursal_id');
      var locsByProv={}; (asign.data||[]).forEach(function(x){ (locsByProv[x.proveedor_id]=locsByProv[x.proveedor_id]||[]).push(x.sucursal_id); });
      var dp=await sb.from('deuda_proveedores').select('proveedor_id,tipo,monto'); if(dp.error) throw dp.error;
      var saldo={}; (dp.data||[]).forEach(function(x){ if(x.proveedor_id==null) return; var v=Number(x.monto)||0; saldo[x.proveedor_id]=(saldo[x.proveedor_id]||0)+(/pago/i.test(x.tipo)?-v:v); });
      var pr=await sb.from('proveedores').select('id,nombre,activo').order('nombre'); if(pr.error) throw pr.error;
      return {ok:true, deudas:(pr.data||[]).filter(function(p){return p.activo!==false;}).map(function(p){
        var scopeNames=(locsByProv[p.id]||[]).map(function(s){ return idToName[s]||String(s); });
        return { proveedorId:p.id, proveedor:p.nombre, saldo:+((saldo[p.id]||0)).toFixed(2), junta:scopeNames.length>1, localesJunta:scopeNames, scope:scopeNames, todos:true };
      }).filter(function(d){ return Math.abs(d.saldo)>0.5; }).sort(function(a,b){ return b.saldo-a.saldo; })};
    },
    getMovCuenta: async function(params){
      var id=params&&params.id; if(!id) return {ok:true, movimientos:[], saldo:0};
      var r=await sb.from('deuda_proveedores').select('fecha,tipo,monto,descripcion,comprobante,forma_pago,sucursal_id').eq('cuenta_id',id).order('fecha'); if(r.error) throw r.error;
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      var saldo=0; var movs=(r.data||[]).map(function(m){ var v=Number(m.monto)||0; if(/pago/i.test(m.tipo)) saldo-=v; else saldo+=v; return { fecha:m.fecha, tipo:m.tipo, monto:v, descripcion:m.descripcion||'', comprobante:m.comprobante||'', formaPago:m.forma_pago||'', local:idToName[m.sucursal_id]||'', saldo:saldo }; });
      return {ok:true, movimientos:movs, saldo:saldo};
    },
    getCajaAbierta: async function(params){
      var m=await sucIdMap(); var sid=params&&params.sucursal?m[params.sucursal]:null; if(!sid) return {ok:true, caja:null};
      var r=await sb.from('cajas').select('id,cajero,apertura,abierta_at').eq('sucursal_id',sid).eq('cerrada',false).order('abierta_at',{ascending:false}).limit(1).maybeSingle();
      if(r.error) throw r.error;
      return {ok:true, caja:(r.data?{ id:r.data.id, cajero:r.data.cajero||'', apertura:Number(r.data.apertura)||0, abiertaAt:r.data.abierta_at }:null)};
    },
    getCajaResumen: async function(params){
      var id=params&&params.id; if(!id) return {ok:false, error:'falta caja'};
      var r=await sb.rpc('caja_resumen',{ p_caja_id:id }); if(r.error) throw r.error; return {ok:true, resumen:r.data};
    },
    // Total bruto de Clover (API de la terminal) para la VENTANA del turno de una caja.
    // Trae las transacciones del/los día(s) de la caja y las filtra por apertura→cierre(o ahora).
    // Devuelve {configurado:false} si el local no tiene terminal Clover cargada.
    getCloverAutoCaja: async function(params){
      var id=params&&params.id; if(!id) return {ok:false, error:'falta caja'};
      var cj=await sb.from('cajas').select('sucursal_id,abierta_at,cerrada_at').eq('id',id).maybeSingle();
      if(cj.error) throw cj.error; if(!cj.data) return {ok:true, configurado:false};
      var sid=cj.data.sucursal_id, ini=cj.data.abierta_at, fin=cj.data.cerrada_at||new Date().toISOString();
      var cc=await sb.from('clover_cuentas_estado').select('sucursal_id,activo').eq('sucursal_id',sid).maybeSingle();
      if(!cc.data || cc.data.activo===false) return {ok:true, configurado:false};
      function diaAR(x){ return new Date(x).toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}); }
      var inv;
      try{ inv=await sb.functions.invoke('clover-tx', { body:{ sucursal_id:sid, desde:diaAR(ini), hasta:diaAR(fin) } }); }
      catch(e){ return {ok:true, configurado:true, error:(e.message||String(e))}; }
      if(inv.error) return {ok:true, configurado:true, error:(inv.error.message||String(inv.error))};
      var d=inv.data||{};
      if(d.error) return {ok:true, configurado:!/terminal|cuenta|configur/i.test(d.error), error:d.error};
      var t0=new Date(ini).getTime(), t1=new Date(fin).getTime(), bruto=0, cant=0, porMedio={};
      (d.tx||[]).forEach(function(t){ var tm=new Date(t.fecha).getTime(); if(tm>=t0 && tm<=t1){ var mo=Number(t.monto)||0; bruto+=mo; cant++; var k=t.medio||'(s/medio)'; porMedio[k]=(porMedio[k]||0)+mo; } });
      return {ok:true, configurado:true, bruto:+bruto.toFixed(2), cant:cant, porMedio:porMedio, merchant:d.merchant||''};
    },
    getCajas: async function(params){
      params=params||{};
      var m=await sucIdMap(); var q=sb.from('cajas').select('id,sucursal_id,cajero,apertura,abierta_at,cerrada,cerrada_at,esperado,cierre_efectivo,diferencia,a_reserva,queda_caja,clover_sistema,clover_informado').order('abierta_at',{ascending:false});
      if(params.sucursal){ var sid=m[params.sucursal]; if(sid) q=q.eq('sucursal_id',sid); }
      if(params.desde) q=q.gte('abierta_at', desdeAR(params.desde));
      if(params.hasta) q=q.lte('abierta_at', hastaAR(params.hasta));
      if(params.soloCerradas==='1') q=q.eq('cerrada', true);
      q=q.limit(params.desde||params.hasta?5000:100);
      var r=await q; if(r.error) throw r.error;
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      return {ok:true, cajas:(r.data||[]).map(function(c){ return { id:c.id, local:idToName[c.sucursal_id]||'', cajero:c.cajero||'', apertura:Number(c.apertura)||0, abiertaAt:c.abierta_at, cerrada:c.cerrada, cerradaAt:c.cerrada_at, esperado:Number(c.esperado)||0, contado:Number(c.cierre_efectivo)||0, diferencia:Number(c.diferencia)||0, aReserva:Number(c.a_reserva)||0, quedaCaja:Number(c.queda_caja)||0, cloverSistema:(c.clover_sistema==null?null:Number(c.clover_sistema)), cloverInformado:(c.clover_informado==null?null:Number(c.clover_informado)) }; })};
    },
    getReserva: async function(params){
      var m=await sucIdMap(); var sid=params&&params.sucursal?m[params.sucursal]:null; if(!sid) return {ok:true, saldo:0, movimientos:[]};
      var mv=await sb.from('efectivo_reserva_mov').select('fecha,tipo,monto,concepto').eq('sucursal_id',sid);
      var gr=await sb.from('gastos').select('fecha,monto,descripcion').eq('sucursal_id',sid).eq('fondo','reserva').ilike('forma_pago','efectivo%');
      var pr=await sb.from('deuda_proveedores').select('fecha,monto,descripcion').eq('sucursal_id',sid).eq('fondo','reserva').eq('tipo','pago').ilike('forma_pago','efectivo%');
      var movs=[];
      (mv.data||[]).forEach(function(x){ movs.push({ fecha:x.fecha, tipo:x.tipo, monto:Number(x.monto)||0, concepto:x.concepto||'' }); });
      (gr.data||[]).forEach(function(x){ movs.push({ fecha:x.fecha, tipo:'egreso', monto:Number(x.monto)||0, concepto:'Gasto: '+(x.descripcion||'') }); });
      (pr.data||[]).forEach(function(x){ movs.push({ fecha:x.fecha, tipo:'egreso', monto:Number(x.monto)||0, concepto:(x.descripcion||'Pago proveedor') }); });
      movs.sort(function(a,b){ return new Date(b.fecha)-new Date(a.fecha); });
      var saldo=movs.reduce(function(s,x){ return s + (x.tipo==='ingreso'?x.monto:-x.monto); },0);
      return {ok:true, saldo:saldo, movimientos:movs};
    },
    getKardex: async function(params){
      var cod=params&&params.codigo; if(!cod) return {ok:true, movimientos:[]};
      var pid=await prodIdPorCod(cod); if(!pid) return {ok:true, movimientos:[]};
      var q=sb.from('stock_movimientos').select('delta,tipo,ref,fecha,sucursal_id').eq('producto_id',pid).order('fecha',{ascending:false}).limit(500);
      if(params.sucursal){ var m=await sucIdMap(); var sid=m[params.sucursal]; if(sid) q=q.eq('sucursal_id',sid); }
      var r=await q; if(r.error) throw r.error;
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      return {ok:true, movimientos:(r.data||[]).map(function(x){ return { fecha:x.fecha, delta:Number(x.delta)||0, tipo:x.tipo, ref:x.ref||'', local:idToName[x.sucursal_id]||'' }; })};
    },
    // Movimientos de stock de un local (sucursal) o de TODA la empresa (sin sucursal),
    // con rango de fechas opcional. Para el export de movimientos de stock.
    getMovimientosStock: async function(params){
      params=params||{};
      var q=sb.from('stock_movimientos').select('delta,tipo,ref,fecha,sucursal_id,producto:productos(nombre,codigo_interno)').order('fecha',{ascending:false}).limit(10000);
      if(params.sucursal){ var m=await sucIdMap(); var sid=m[params.sucursal]; if(!sid) return {ok:true, movimientos:[]}; q=q.eq('sucursal_id',sid); }
      if(params.desde) q=q.gte('fecha',desdeAR(params.desde));
      if(params.hasta) q=q.lte('fecha',hastaAR(params.hasta));
      var r=await q; if(r.error) throw r.error;
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      return {ok:true, movimientos:(r.data||[]).map(function(x){ return { fecha:x.fecha, delta:Number(x.delta)||0, tipo:x.tipo, ref:x.ref||'', local:idToName[x.sucursal_id]||'', codigo:(x.producto?x.producto.codigo_interno:''), nombre:(x.producto?x.producto.nombre:'') }; })};
    },
    getStock: async function(){
      var r=await sb.from('stock').select('cantidad, prod:productos(codigo_interno), suc:sucursales(nombre)');
      if(r.error) throw r.error;
      return {ok:true, stock:(r.data||[]).map(function(x){ return { codigo:x.prod?x.prod.codigo_interno:null, local:x.suc?x.suc.nombre:null, cantidad:Number(x.cantidad)||0 }; }).filter(function(x){ return x.codigo && x.local; })};
    },
    getCategoriasGasto: async function(){
      var r=await sb.from('categorias_gasto').select('id,nombre,grupo').order('nombre'); if(r.error) throw r.error;
      return {ok:true, categorias:(r.data||[]).map(function(c){ return { id:c.id, nombre:c.nombre, grupo:c.grupo||'' }; })};
    },
    getReparto: async function(){
      var r=await sb.from('reparto_gastos').select('categoria_gasto_id,sucursal_id,porcentaje'); if(r.error) throw r.error;
      return {ok:true, reparto:(r.data||[]).map(function(x){ return { categoriaId:x.categoria_gasto_id, sucursalId:x.sucursal_id, porcentaje:Number(x.porcentaje)||0 }; })};
    },
    getSucursales: async function(){
      var res = await sb.from('sucursales').select('id,nombre,sigla,direccion,telefono,activo').order('nombre');
      if(res.error) throw res.error;
      return {ok:true, sucursales:(res.data||[]).filter(function(s){ return s.activo!==false; }).map(function(s){ return { id:s.id, nombre:s.nombre, sigla:s.sigla||'', direccion:s.direccion||'', telefono:s.telefono||'', activo:s.activo!==false }; })};
    },

    getBalanzas: async function(){
      var res = await sb.from('balanzas').select('prefijo,dato,codlen,datolen,suc:sucursales(nombre)');
      if(res.error) throw res.error;
      var out={};
      (res.data||[]).forEach(function(b){ var n=b.suc?b.suc.nombre:null; if(n) out[n]={ prefijo:String(b.prefijo||''), dato:String(b.dato||''), codlen:String(b.codlen||''), datolen:String(b.datolen||'') }; });
      return {ok:true, balanzas:out};
    },

    // --- HISTÓRICO DE VENTAS (pre-sistema, carga manual) ---
    // Último día cargado / días / total por local (lee la vista agregada, sin tope de 1000 filas).
    getHistoricoResumen: async function(){
      var r=await sb.from('v_historico_resumen').select('sucursal_id,sucursal,ultimo_dia,primer_dia,dias,total').order('sucursal');
      if(r.error) throw r.error;
      return {ok:true, resumen:(r.data||[]).map(function(x){ return { sucursalId:x.sucursal_id, sucursal:x.sucursal, ultimo:x.ultimo_dia, primero:x.primer_dia, dias:Number(x.dias)||0, total:Number(x.total)||0 }; })};
    },

    // --- CLOVER (conciliación) ---
    // Estado de las cuentas (SIN el token: se lee de la vista clover_cuentas_estado).
    getCloverCuentas: async function(){
      var res = await sb.from('clover_cuentas_estado').select('sucursal_id,merchant_id,activo,actualizado');
      if(res.error) throw res.error;
      var out={}; (res.data||[]).forEach(function(c){ out[c.sucursal_id]={ merchant_id:c.merchant_id||'', activo:c.activo!==false, actualizado:c.actualizado||null }; });
      return {ok:true, cuentas:out};
    },
    getCloverAranceles: async function(){
      var res = await sb.from('clover_aranceles').select('medio,arancel_pct,dias_acreditacion,nota').order('medio');
      if(res.error) throw res.error;
      return {ok:true, aranceles:(res.data||[]).map(function(a){ return { medio:a.medio, arancel_pct:Number(a.arancel_pct)||0, dias:Number(a.dias_acreditacion)||0, nota:a.nota||'' }; })};
    },

    // --- COMPRAS EN DOS ETAPAS (borradores) ---
    getComprasBorradores: async function(params){
      var m=await sucIdMap(); var sid=params&&params.sucursal?m[params.sucursal]:null;
      var q=sb.from('compras').select('id,comprobante,total,fecha,usuario_id,proveedor:proveedores(nombre),detalle:compras_detalle(id)').eq('estado','borrador');
      if(sid) q=q.eq('sucursal_id',sid);
      var r=await q.order('fecha',{ascending:false}); if(r.error) throw r.error;
      var pmB=await perfilNombres();
      return {ok:true, borradores:(r.data||[]).map(function(c){ return { id:c.id, comprobante:c.comprobante||'', total:Number(c.total)||0, fecha:c.fecha, proveedor:(c.proveedor?c.proveedor.nombre:''), items:(c.detalle?c.detalle.length:0), cargadoPor:nombreUsuario(pmB,c.usuario_id) }; })};
    },
    getCompraDetalle: async function(params){
      var r=await sb.from('compras_detalle').select('id,cantidad,costo_unit,costo,producto:productos(codigo_interno,nombre)').eq('compra_id', params.id).order('id');
      if(r.error) throw r.error;
      return {ok:true, detalle:(r.data||[]).map(function(d){ return { id:d.id, codigo:(d.producto?d.producto.codigo_interno:''), nombre:(d.producto?d.producto.nombre:''), cantidad:Number(d.cantidad)||0, costo_unit:Number(d.costo_unit)||0, costo:Number(d.costo)||0 }; })};
    },
    // Detalle de una compra CONFIRMADA a partir de su comprobante (+ proveedor, para
    // desambiguar). Se usa en la cuenta del proveedor para ver qué se compró, igual que
    // "Ver detalle" de una venta en la cuenta corriente del cliente.
    getCompraDetallePorComprobante: async function(params){
      var comp=params&&params.comprobante; if(!comp) throw new Error('Falta comprobante');
      var q=sb.from('compras').select('id,comprobante,total,fecha,forma_pago,sucursal:sucursales(nombre),detalle:compras_detalle(cantidad,costo_unit,costo,producto:productos(nombre,codigo_interno))').eq('comprobante',comp).eq('estado','completa');
      if(params.proveedorId) q=q.eq('proveedor_id',params.proveedorId);
      var r=await q.order('id',{ascending:false}).limit(1).maybeSingle();
      if(r.error) throw r.error;
      if(!r.data) return {ok:false, error:'No se encontró la compra '+comp};
      var c=r.data;
      return {ok:true,
        compra:{ id:c.id, comprobante:c.comprobante||'', total:Number(c.total)||0, fecha:c.fecha, formaPago:c.forma_pago||'', sucursal:(c.sucursal?c.sucursal.nombre:'') },
        detalle:(c.detalle||[]).map(function(d){ return { nombre:(d.producto?(d.producto.nombre||d.producto.codigo_interno):'(s/producto)'), codigo:(d.producto?d.producto.codigo_interno:''), cantidad:Number(d.cantidad)||0, costo_unit:Number(d.costo_unit)||0, costo:Number(d.costo)||0 }; })};
    },
    getComprasConfirmadas: async function(params){
      var m=await sucIdMap(); var sid=params&&params.sucursal?m[params.sucursal]:null;
      var q=sb.from('compras').select('id,comprobante,total,fecha,usuario_id,editada_por,editada_at,proveedor:proveedores(nombre),detalle:compras_detalle(cantidad,costo_unit,costo,producto:productos(nombre,codigo_interno))').eq('estado','completa');
      if(sid) q=q.eq('sucursal_id',sid);
      if(params&&params.desde) q=q.gte('fecha',desdeAR(params.desde));
      if(params&&params.hasta) q=q.lte('fecha',hastaAR(params.hasta));
      var r=await q.order('fecha',{ascending:false}).limit(500); if(r.error) throw r.error;
      var pmC=await perfilNombres();
      return {ok:true, compras:(r.data||[]).map(function(c){ return { id:c.id, comprobante:c.comprobante||'', total:Number(c.total)||0, fecha:c.fecha, proveedor:(c.proveedor?c.proveedor.nombre:''), cargadoPor:nombreUsuario(pmC,c.usuario_id), editadaPor:nombreUsuario(pmC,c.editada_por), editadaAt:c.editada_at||null, items:(c.detalle||[]).map(function(d){ return { nombre:(d.producto?(d.producto.nombre||d.producto.codigo_interno):'(s/producto)'), cantidad:Number(d.cantidad)||0, costo_unit:Number(d.costo_unit)||0, costo:Number(d.costo)||0 }; }) }; })};
    },
    getCheques: async function(params){
      params=params||{};
      var m=await sucIdMap();
      var q=sb.from('cheques').select('id,proveedor_id,sucursal_id,banco,numero,fecha_pago,monto,estado,concepto,prov:proveedores(nombre)').order('fecha_pago',{ascending:true}).limit(5000);
      if(params.sucursal){ var sid=m[params.sucursal]; if(sid) q=q.eq('sucursal_id',sid); }
      if(params.sucursales){ var sids=String(params.sucursales).split(',').map(function(s){return s.trim();}).filter(Boolean).map(function(n){return m[n];}).filter(function(x){return x!=null;}); if(sids.length) q=q.in('sucursal_id',sids); }
      if(params.proveedorId) q=q.eq('proveedor_id',params.proveedorId);
      if(params.estado) q=q.eq('estado',params.estado);
      if(params.desde) q=q.gte('fecha_pago',params.desde);
      if(params.hasta) q=q.lte('fecha_pago',params.hasta);
      var r=await q;
      if(r.error){ if(/relation|does not exist|schema cache|could not find/i.test(r.error.message||'')) return {ok:true, cheques:[], sinTabla:true}; throw r.error; }
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      return {ok:true, cheques:(r.data||[]).map(function(c){ return { id:c.id, proveedor:(c.prov?c.prov.nombre:''), proveedorId:c.proveedor_id, local:idToName[c.sucursal_id]||'', banco:c.banco||'', numero:c.numero||'', fecha:c.fecha_pago, monto:Number(c.monto)||0, estado:c.estado||'emitido', concepto:c.concepto||'' }; })};
    }
  };

  // ---------------- ESCRITURAS ----------------
  function hoy(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}); }
  var _listaId=null, _catId=null;
  async function listaIdMap(){ if(_listaId) return _listaId; var r=await sb.from('listas_precio').select('id,nombre'); _listaId={}; (r.data||[]).forEach(function(l){ _listaId[l.nombre]=l.id; }); return _listaId; }
  async function catIdMap(){ if(_catId) return _catId; var r=await sb.from('categorias').select('id,nombre'); _catId={}; (r.data||[]).forEach(function(c){ _catId[c.nombre]=c.id; }); return _catId; }
  var _sucId=null;
  async function sucIdMap(){ if(_sucId) return _sucId; var r=await sb.from('sucursales').select('id,nombre,sigla'); _sucId={}; (r.data||[]).forEach(function(s){ _sucId[s.nombre]=s.id; if(s.sigla) _sucId[s.sigla]=s.id; }); return _sucId; }
  // Mapa local_id -> grupo_id (al que pertenece el local). Si el local no tiene grupo,
  // se trata como grupo propio ('L'+id) para no fusionarlo por error con otros.
  var _grpMap=null;
  async function grupoMap(){ if(_grpMap) return _grpMap; var r=await sb.from('sucursales').select('id,grupo_id'); _grpMap={}; (r.data||[]).forEach(function(s){ _grpMap[s.id]= s.grupo_id || ('L'+s.id); }); return _grpMap; }

  // Al CERRAR la caja de un local, genera el cruce diario al GRUPO cobrador (el que cobra
  // todas las liquidaciones, marcado en Config → Grupos). Fuente de verdad = Clover, NO la
  // forma de pago de la venta (que puede estar mal marcada). Dos movimientos:
  //   1) Clover (tarjeta/QR): NETO estimado = bruto por medio − arancel − impuestos (misma
  //      fórmula que Conciliación; aranceles + IVA/percepción/IIBB de Config → Clover).
  //   2) Virtual: total de ventas con forma de pago Virtual del turno, DIRECTO (sin descuento),
  //      porque no pasa por Clover pero lo cobra el mismo grupo por otro canal.
  // El grupo cobrador queda debiéndole esos montos al grupo del local. Idempotente por caja
  // (borra los cruces previos de esa caja antes de reinsertar). Nunca rompe el cierre.
  async function generarCruceCloverVirtual(cajaId){
    var cj=await sb.from('cajas').select('sucursal_id,abierta_at,cerrada_at').eq('id',cajaId).maybeSingle();
    if(cj.error || !cj.data) return;
    var sid=cj.data.sucursal_id, ini=cj.data.abierta_at, fin=cj.data.cerrada_at||new Date().toISOString();
    var gm=await grupoMap();
    var grupoVenta=gm[sid];
    var cob=await sb.from('grupos').select('id').eq('cobra_no_efectivo',true).maybeSingle();
    var grupoCobrador=(cob.data?cob.data.id:null);
    if(!grupoVenta || !grupoCobrador || String(grupoVenta)===String(grupoCobrador)) return;  // mismo grupo / sin cobrador: no hay cruce
    // Limpiar cruces previos de esta caja (re-cierre / re-proceso) para no duplicar.
    await sb.from('cuentas_internas').delete().in('ref',['caja:'+cajaId+':clover','caja:'+cajaId+':virtual']);

    // 1) CLOVER (neto estimado por medio).
    try{
      var ca=await readers.getCloverAutoCaja({id:cajaId});
      if(ca && ca.ok && ca.configurado && ca.porMedio){
        var ar=await readers.getCloverAranceles(); var ARA={}; ((ar&&ar.aranceles)||[]).forEach(function(a){ ARA[String(a.medio||'').toLowerCase().trim()]=Number(a.arancel_pct)||0; });
        var IMP={iva:21,percep:3,iibb:0.5};
        try{ var cg=await readers.getConfigGeneral(); if(cg&&cg.ok&&cg.config&&cg.config.clover_imp){ var o=JSON.parse(cg.config.clover_imp)||{}; if(o.iva!=null)IMP.iva=Number(o.iva); if(o.percep!=null)IMP.percep=Number(o.percep); if(o.iibb!=null)IMP.iibb=Number(o.iibb); } }catch(e){}
        var neto=0;
        Object.keys(ca.porMedio).forEach(function(medio){
          var bruto=Number(ca.porMedio[medio])||0; if(!(bruto>0)) return;
          var pct=ARA[String(medio||'').toLowerCase().trim()]||0;            // sin arancel cargado → 0% (va casi bruto)
          var arancel=bruto*pct/100;
          var imp=arancel*((Number(IMP.iva)||0)+(Number(IMP.percep)||0))/100 + bruto*(Number(IMP.iibb)||0)/100;
          neto += (bruto - arancel - imp);
        });
        neto=Math.round(neto*100)/100;
        if(neto>0){
          await sb.from('cuentas_internas').insert({ grupo_origen:grupoCobrador, grupo_destino:grupoVenta, tipo:'clover', concepto:'Clover (neto estimado) acreditado al grupo cobrador', monto:neto, ref:'caja:'+cajaId+':clover' });
        }
      }
    }catch(e){}

    // 2) VIRTUAL (total del turno, directo).
    try{
      var vq=await sb.from('ventas').select('id').eq('sucursal_id',sid).gte('fecha',ini).lte('fecha',fin).neq('estado','anulada');
      var ids=((vq.data)||[]).map(function(v){ return v.id; });
      var virt=0;
      if(ids.length){
        var pq=await sb.from('pagos').select('monto,metodo').in('venta_id',ids).ilike('metodo','virtual%');
        ((pq.data)||[]).forEach(function(x){ virt += Number(x.monto)||0; });
      }
      virt=Math.round(virt*100)/100;
      if(virt>0){
        await sb.from('cuentas_internas').insert({ grupo_origen:grupoCobrador, grupo_destino:grupoVenta, tipo:'virtual', concepto:'Virtual acreditado al grupo cobrador', monto:virt, ref:'caja:'+cajaId+':virtual' });
      }
    }catch(e){}
  }
  // Mapa auth.uid -> nombre de usuario (para "cargado por"). Cacheado por sesión.
  var _perfN=null;
  async function perfilNombres(){ if(_perfN) return _perfN; _perfN={}; try{ var r=await sb.from('perfiles').select('usuario_id,nombre,usuario'); (r.data||[]).forEach(function(p){ if(p.usuario_id) _perfN[p.usuario_id]=p.nombre||p.usuario||''; }); }catch(e){} return _perfN; }
  function nombreUsuario(pm, uid){ return uid ? (pm[uid]||'—') : ''; }
  var _provId=null;
  async function provIdMap(){ if(_provId) return _provId; var r=await sb.from('proveedores').select('id,nombre'); _provId={}; (r.data||[]).forEach(function(p){ _provId[p.nombre]=p.id; }); return _provId; }
  async function prodIdPorCod(cod){ var r=await sb.from('productos').select('id').eq('codigo_interno',String(cod)).maybeSingle(); return (r.data&&r.data.id)||null; }
  async function catIdOrCreate(nombre){ if(!nombre) return null; var m=await catIdMap(); if(m[nombre]) return m[nombre]; var ins=await sb.from('categorias').insert({nombre:nombre}).select('id').single(); if(ins.error) throw ins.error; _catId[nombre]=ins.data.id; return ins.data.id; }

  // Deriva el "fondo" de efectivo a partir de la forma de pago elegida en compras/gastos.
  //   "Caja guardada"/"...guardado" -> reserva ; "Caja del día" -> caja ; otras (tarjeta/virtual) -> null
  function fondoDeForma(f){ var s=String(f||'').toLowerCase(); if(s.indexOf('guard')>=0) return 'reserva'; if(s.indexOf('caja del')>=0) return 'caja'; return null; }

  var writers = {
    // --- PRODUCTOS ---
    setCostoProducto: async function(p){
      var pid=await prodIdPorCod(String(p.codigo)); if(!pid) throw new Error('Producto no encontrado: '+p.codigo);
      var costo=(p.costo===''||p.costo==null?null:Number(p.costo));
      // Guarda el último costo y, si corresponde, recalcula Minorista (manteniendo el
      // margen que ya tenía) y las derivadas. Toda la lógica vive en el RPC.
      var r=await sb.rpc('aplicar_costo_producto',{ p_producto_id:pid, p_costo:costo });
      if(r.error) throw r.error;
      // Devolver los precios recalculados para refrescar la grilla sin recargar.
      var pp=await sb.from('producto_precios').select('precio,lista:listas_precio(nombre)').eq('producto_id',pid);
      var precios={}; (pp.data||[]).forEach(function(x){ if(x.lista&&x.lista.nombre) precios[x.lista.nombre]=Number(x.precio); });
      return {ok:true, precios:precios};
    },
    setPrecioProducto: async function(p){
      var pid=await prodIdPorCod(p.codigo); var lm=await listaIdMap(); var lid=lm[p.lista];
      if(!pid) throw new Error('Producto no encontrado: '+p.codigo);
      if(!lid) throw new Error('Lista no encontrada: '+p.lista);
      var r=await sb.from('producto_precios').upsert({ producto_id:pid, lista_id:lid, precio:Number(p.precio), fecha:hoy() }, { onConflict:'producto_id,lista_id' });
      if(r.error) throw r.error; return {ok:true};
    },
    setMargenProducto: async function(p){
      var r=await sb.from('productos').update({ margen_override:(p.margen===''||p.margen==null?null:Number(p.margen)) }).eq('codigo_interno',String(p.codigo));
      if(r.error) throw r.error; return {ok:true};
    },
    setNombreProducto: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('El nombre no puede quedar vacío');
      var r=await sb.from('productos').update({ nombre:nombre }).eq('codigo_interno',String(p.codigo));
      if(r.error) throw r.error; return {ok:true};
    },
    setProductoActivo: async function(p){
      var r=await sb.from('productos').update({ activo:!!p.activo }).eq('codigo_interno',String(p.codigo));
      if(r.error) throw r.error; return {ok:true};
    },
    // Borrado DEFINITIVO de un producto. Limpia primero lo de catálogo/stock
    // (precios, stock, snapshots, ofertas, componentes de combo). Si el producto
    // tiene movimientos (ventas/compras/remitos/elaboraciones) la base lo frena:
    // en ese caso devolvemos un mensaje claro para que se dé de baja.
    eliminarProducto: async function(p){
      var cod=String(p.codigo||''); var pid=await prodIdPorCod(cod);
      if(!pid) throw new Error('Producto no encontrado: '+cod);
      await sb.from('producto_precios').delete().eq('producto_id',pid);
      await sb.from('ofertas').delete().eq('producto_id',pid);
      await sb.from('combo_componentes').delete().eq('producto_id',pid);
      await sb.from('stock_snapshots').delete().eq('producto_id',pid);
      await sb.from('stock_movimientos').delete().eq('producto_id',pid);
      await sb.from('stock').delete().eq('producto_id',pid);
      var r=await sb.from('productos').delete().eq('id',pid);
      if(r.error){
        throw new Error('No se puede borrar: el producto tiene movimientos (ventas, compras o remitos). Dalo de baja en su lugar. ['+(r.error.message||r.error.code||'')+']');
      }
      return {ok:true};
    },
    crearProducto: async function(p){
      var cid=await catIdOrCreate(p.categoria||'');
      var ins=await sb.from('productos').insert({ codigo_interno:String(p.codigo), nombre:p.nombre||'', marca:p.marca||'', categoria_id:cid, tipo:(p.tipo==='unidad'?'unidad':'pesable'), costo:(p.costo===''||p.costo==null?null:Number(p.costo)), margen_override:(p.margen===''||p.margen==null?null:Number(p.margen)), activo:true, fecha_costo:(p.costo?hoy():null) }).select('id').single();
      if(ins.error) throw ins.error;
      var pid=ins.data.id, lm=await listaIdMap(), rows=[];
      Object.keys(p.precios||{}).forEach(function(l){ var v=Number(p.precios[l]); if(lm[l] && v>0) rows.push({ producto_id:pid, lista_id:lm[l], precio:v, fecha:hoy() }); });
      if(rows.length){ var pr=await sb.from('producto_precios').insert(rows); if(pr.error) throw pr.error; }
      return {ok:true, id:pid};
    },
    // Import masivo: filas = [{codigo,nombre,marca,categoria,tipo,costo,margen,precios:{lista:val}}]
    importProductos: async function(p){
      var filas=p.filas||[]; var lm=await listaIdMap(); var creados=0, actualizados=0, errores=[];
      // Nombre de la lista base (Minorista) para saber si la fila trae precio explícito.
      var lp=await sb.from('listas_precio').select('nombre,tipo'); var baseNom=((lp.data||[]).filter(function(x){return x.tipo==='base';})[0]||{}).nombre||'Minorista';
      for(var i=0;i<filas.length;i++){
        var f=filas[i]; var cod=String(f.codigo||'').trim(); if(!cod) continue;
        try{
          var cid=await catIdOrCreate(f.categoria||'');
          var costo=(f.costo===''||f.costo==null?null:Number(f.costo));
          // El costo se aplica aparte (puede recalcular precios), no en este update/insert.
          var prod={ nombre:f.nombre||'', marca:f.marca||'', categoria_id:cid, tipo:(f.tipo==='unidad'?'unidad':'pesable'),
            margen_override:(f.margen===''||f.margen==null?null:Number(f.margen)) };
          var ex=await sb.from('productos').select('id').eq('codigo_interno',cod).maybeSingle();
          var pid;
          if(ex.data){ var u=await sb.from('productos').update(prod).eq('id',ex.data.id); if(u.error) throw u.error; pid=ex.data.id; actualizados++; }
          else { prod.codigo_interno=cod; prod.activo=true; var ins=await sb.from('productos').insert(prod).select('id').single(); if(ins.error) throw ins.error; pid=ins.data.id; creados++; }
          // ¿La fila trae Minorista explícito? Si sí, respetamos los precios pegados.
          var minExplicito=(f.precios && f.precios[baseNom]!=null && f.precios[baseNom]!=='' && Number(f.precios[baseNom])>0);
          if(costo!=null && costo>0 && !minExplicito){
            // Guarda el costo y deriva Minorista + derivadas desde el margen (el que ya tenía).
            var rc=await sb.rpc('aplicar_costo_producto',{ p_producto_id:pid, p_costo:costo }); if(rc.error) throw rc.error;
          } else {
            await sb.from('productos').update({ costo:costo, fecha_costo:(costo!=null?hoy():null) }).eq('id',pid);
          }
          // Precios explícitos de la fila: pisan lo derivado (lo pegado manda).
          var rows=[]; Object.keys(f.precios||{}).forEach(function(l){ var v=Number(f.precios[l]); if(lm[l] && v>0) rows.push({ producto_id:pid, lista_id:lm[l], precio:v, fecha:hoy() }); });
          if(rows.length){ var pr=await sb.from('producto_precios').upsert(rows,{onConflict:'producto_id,lista_id'}); if(pr.error) throw pr.error; }
        }catch(e){ errores.push(cod+': '+(e.message||e)); }
        if(typeof p.onProgress==='function'){ try{ p.onProgress(i+1, filas.length); }catch(_e){} if((i & 7)===0) await new Promise(function(r){ setTimeout(r,0); }); }
      }
      return {ok:true, creados:creados, actualizados:actualizados, errores:errores};
    },
    // --- CLIENTES ---
    guardarCliente: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('Falta el nombre');
      var lm=await listaIdMap(); var sm=await sucIdMap();
      var payload={ nombre:nombre, lista_id:(p.lista?(lm[p.lista]||null):null), administrador_suc_id:(p.administrador?(sm[p.administrador]||null):null) };
      if(p.activo!=null) payload.activo=!!p.activo;
      if(p.realId){ var r=await sb.from('clientes').update(payload).eq('id',p.realId); if(r.error) throw r.error; return {ok:true, id:p.realId}; }
      var ins=await sb.from('clientes').insert(payload).select('id').single(); if(ins.error) throw ins.error; return {ok:true, id:ins.data.id};
    },
    eliminarCliente: async function(p){
      if(!p.realId) throw new Error('Falta el cliente'); var r=await sb.from('clientes').update({activo:false}).eq('id',p.realId); if(r.error) throw r.error; return {ok:true};
    },
    // --- CATEGORÍAS ---
    guardarCategoria: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('Falta el nombre');
      var payload={ margen_pct:(p.margen===''||p.margen==null?null:Number(p.margen)), plus_remito_pct:(p.plusRemito===''||p.plusRemito==null?null:Number(p.plusRemito)) };
      var ex=await sb.from('categorias').select('id').eq('nombre',nombre).maybeSingle();
      if(ex.data){ var r=await sb.from('categorias').update(payload).eq('nombre',nombre); if(r.error) throw r.error; }
      else { payload.nombre=nombre; var r2=await sb.from('categorias').insert(payload); if(r2.error) throw r2.error; _catId=null; }
      return {ok:true};
    },
    // --- LISTAS DE PRECIO ---
    guardarLista: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('Falta el nombre');
      var tipo=(p.tipo||'especial');
      var payload={ tipo:tipo, relacion_pct:(tipo==='derivada'?(p.relacion===''||p.relacion==null?null:Number(p.relacion)):null) };
      var ex=await sb.from('listas_precio').select('id').eq('nombre',nombre).maybeSingle();
      if(ex.data){ var r=await sb.from('listas_precio').update(payload).eq('nombre',nombre); if(r.error) throw r.error; }
      else { payload.nombre=nombre; var r2=await sb.from('listas_precio').insert(payload); if(r2.error) throw r2.error; _listaId=null; }
      return {ok:true};
    },
    eliminarLista: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('Falta la lista');
      var r=await sb.from('listas_precio').delete().eq('nombre',nombre);
      if(r.error) throw new Error('No se pudo borrar (¿hay clientes usando esta lista?): '+r.error.message);
      _listaId=null; return {ok:true};
    },
    // --- OFERTAS ---
    crearOferta: async function(p){
      var pid=await prodIdPorCod(p.codigo); if(!pid) throw new Error('Producto no encontrado: '+p.codigo);
      await sb.from('ofertas').delete().eq('producto_id',pid);   // una oferta por producto: reemplaza
      var ins={ producto_id:pid, precio_oferta:Number(p.precio), tipo:(p.tipo||'kg'),
        kilaje_minimo:(p.kilaje===''||p.kilaje==null?null:Number(p.kilaje)),
        kilaje_maximo:(p.kilajeMax===''||p.kilajeMax==null?null:Number(p.kilajeMax)),
        forma_pago:(p.formaPago?String(p.formaPago):null),
        fecha_desde:(p.desde||null), fecha_hasta:(p.hasta||null), activa:true, locales:(p.locales||'todos') };
      var r=await sb.from('ofertas').insert(ins); if(r.error) throw r.error; return {ok:true};
    },
    eliminarOferta: async function(p){
      var pid=await prodIdPorCod(p.codigo); if(!pid) return {ok:true};
      var r=await sb.from('ofertas').delete().eq('producto_id',pid); if(r.error) throw r.error; return {ok:true};
    },
    // --- COMBOS ---
    crearCombo: async function(p){
      var ins=await sb.from('combos').insert({ nombre:p.nombre, activo:true, locales:(p.locales||'todos'), tipo:(p.tipo||'promo'), precio_cerrado:(p.precioCerrado===''||p.precioCerrado==null?null:Number(p.precioCerrado)) }).select('id').single();
      if(ins.error) throw ins.error; var cid=ins.data.id, comps=[];
      for(var i=0;i<(p.componentes||[]).length;i++){ var c=p.componentes[i]; if(!c.codigo) continue; var pid=await prodIdPorCod(c.codigo); if(!pid) continue;
        comps.push({ combo_id:cid, producto_id:pid, minimo:(c.minimo===''||c.minimo==null?null:Number(c.minimo)), precio_promo:(c.precioPromo===''||c.precioPromo==null?null:Number(c.precioPromo)), peso_unitario:(c.pesoUnitario===''||c.pesoUnitario==null?null:Number(c.pesoUnitario)) }); }
      if(comps.length){ var r=await sb.from('combo_componentes').insert(comps); if(r.error){ await sb.from('combos').delete().eq('id',cid); throw r.error; } }
      return {ok:true, id:cid};
    },
    eliminarCombo: async function(p){
      var r=await sb.from('combos').delete().eq('id',p.id); if(r.error) throw r.error; return {ok:true};
    },
    // --- CONFIG GENERAL ---
    guardarConfig: async function(p){
      var clave=String(p.clave||'').trim(); if(!clave) throw new Error('Falta la clave');
      var valor=(p.valor==null?'':(typeof p.valor==='string'?p.valor:JSON.stringify(p.valor)));
      var r=await sb.from('config_general').upsert({ clave:clave, valor:valor }, { onConflict:'clave' });
      if(r.error) throw r.error; return {ok:true};
    },
    // --- STOCK ---
    ajustarStock: async function(p){
      var pid=await prodIdPorCod(p.codigo); if(!pid) throw new Error('Producto no encontrado: '+p.codigo);
      var m=await sucIdMap(); var sid=m[p.local]; if(!sid) throw new Error('Local no encontrado: '+p.local);
      var nueva=(p.cantidad===''||p.cantidad==null?0:Number(p.cantidad));
      var cur=await sb.from('stock').select('cantidad').eq('producto_id',pid).eq('sucursal_id',sid).maybeSingle();
      var old=(cur.data&&Number(cur.data.cantidad))||0;
      var up=await sb.from('stock').upsert({ producto_id:pid, sucursal_id:sid, cantidad:nueva },{ onConflict:'producto_id,sucursal_id' }); if(up.error) throw up.error;
      var delta=+(nueva-old).toFixed(3);
      if(delta!==0) await sb.from('stock_movimientos').insert({ producto_id:pid, sucursal_id:sid, delta:delta, tipo:(p.tipo||'ajuste'), ref:(p.motivo||'ajuste manual') });
      return {ok:true};
    },
    // filas = [{codigo, cantidades:{ 'Fabrica':10, 'Central':5, ... }}]
    importStockInicial: async function(p){
      var filas=p.filas||[]; var m=await sucIdMap(); var okc=0, err=[];
      for(var i=0;i<filas.length;i++){
        var f=filas[i]; var pid=await prodIdPorCod(f.codigo); if(!pid){ err.push((f.codigo||'?')+': producto no existe'); continue; }
        var cants=f.cantidades||{};
        for(var loc in cants){ if(!cants.hasOwnProperty(loc)) continue;
          var sid=m[loc]; if(!sid){ err.push(loc+': local desconocido'); continue; }
          var q=Number(cants[loc]); if(isNaN(q)) continue;
          var cur=await sb.from('stock').select('cantidad').eq('producto_id',pid).eq('sucursal_id',sid).maybeSingle();
          var old=(cur.data&&Number(cur.data.cantidad))||0;
          var up=await sb.from('stock').upsert({ producto_id:pid, sucursal_id:sid, cantidad:q },{ onConflict:'producto_id,sucursal_id' });
          if(up.error){ err.push(f.codigo+'/'+loc+': '+up.error.message); continue; }
          var d=+(q-old).toFixed(3); if(d!==0) await sb.from('stock_movimientos').insert({ producto_id:pid, sucursal_id:sid, delta:d, tipo:'inicial', ref:'carga inicial' });
          okc++;
        }
      }
      return {ok:true, actualizados:okc, errores:err};
    },
    // --- ROLES / PERFILES ---
    guardarRol: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('Falta el nombre');
      if(p.id){ var r=await sb.from('roles').update({nombre:nombre}).eq('id',p.id); if(r.error) throw r.error; return {ok:true,id:p.id}; }
      var ins=await sb.from('roles').insert({nombre:nombre}).select('id').single(); if(ins.error) throw ins.error; return {ok:true,id:ins.data.id};
    },
    eliminarRol: async function(p){
      if(!p.id) throw new Error('Falta id'); var r=await sb.from('roles').delete().eq('id',p.id);
      if(r.error){ var u=await sb.from('roles').update({activo:false}).eq('id',p.id); if(u.error) throw u.error; return {ok:true,soft:true}; } return {ok:true};
    },
    setRolPermisos: async function(p){
      await sb.from('rol_permisos').delete().eq('rol_id',p.rolId);
      var rows=(p.permisos||[]).map(function(k){ return {rol_id:p.rolId, permiso:k}; });
      if(rows.length){ var r=await sb.from('rol_permisos').insert(rows); if(r.error) throw r.error; }
      return {ok:true};
    },
    crearUsuarioAuth: async function(p){
      var s=await sb.auth.getSession(); var tok=(s.data&&s.data.session&&s.data.session.access_token)||'';
      try{
        var res=await fetch(SUPABASE_URL+'/functions/v1/crear-usuario', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+tok, 'apikey':SUPABASE_ANON }, body:JSON.stringify({ usuario:p.usuario, password:p.password, email:(p.email||'') }) });
        var j=await res.json();
        return j;
      }catch(e){ return {ok:false, error:'No se pudo contactar la función (¿está deployada?): '+(e.message||e)}; }
    },
    setPasswordUsuario: async function(p){
      var s=await sb.auth.getSession(); var tok=(s.data&&s.data.session&&s.data.session.access_token)||'';
      if(!p.usuario_id) return {ok:false, error:'Este usuario no tiene login creado (reseteá la contraseña recreándolo o pedí que entre una vez).'};
      try{
        var res=await fetch(SUPABASE_URL+'/functions/v1/crear-usuario', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+tok, 'apikey':SUPABASE_ANON }, body:JSON.stringify({ modo:'password', usuario_id:p.usuario_id, password:p.password }) });
        return await res.json();
      }catch(e){ return {ok:false, error:'No se pudo contactar la función: '+(e.message||e)}; }
    },
    guardarPerfil: async function(p){
      var m=await sucIdMap(); var payload={ nombre:(p.nombre||null), rol_id:(p.rolId||null) }; var pid=p.id;
      if(p.usuario!=null) payload.usuario=(String(p.usuario).trim()||null);
      if(p.usuario_id) payload.usuario_id=p.usuario_id;
      var email=String(p.email||'').trim().toLowerCase();
      if(!pid){ if(!email) throw new Error('Falta el email de cuenta'); payload.email=email; }
      else if(email) payload.email=email;   // en edición normalmente NO se cambia
      if(pid){ var r=await sb.from('perfiles').update(payload).eq('id',pid); if(r.error) throw r.error; }
      else { var ex=await sb.from('perfiles').select('id').eq('email',email).maybeSingle(); if(ex.data){ pid=ex.data.id; var u=await sb.from('perfiles').update(payload).eq('id',pid); if(u.error) throw u.error; } else { var ins=await sb.from('perfiles').insert(payload).select('id').single(); if(ins.error) throw ins.error; pid=ins.data.id; } }
      await sb.from('usuario_locales').delete().eq('perfil_id',pid);
      var locs=(p.locales||[]).map(function(l){ return (typeof l==='number')?l:(m[l]||null); }).filter(Boolean);
      if(locs.length){ var rows=locs.map(function(sid){ return {perfil_id:pid, sucursal_id:sid}; }); var rl=await sb.from('usuario_locales').insert(rows); if(rl.error) throw rl.error; }
      return {ok:true, id:pid};
    },
    eliminarPerfil: async function(p){
      if(!p.id) throw new Error('Falta id'); var r=await sb.from('perfiles').delete().eq('id',p.id);
      if(r.error){ var u=await sb.from('perfiles').update({activo:false}).eq('id',p.id); if(u.error) throw u.error; return {ok:true,soft:true}; } return {ok:true};
    },
    // --- PROVEEDORES ---
    guardarProveedor: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('Falta el nombre');
      var payload={ nombre:nombre, cuit:(p.cuit?String(p.cuit).trim():null), email:(p.email?String(p.email).trim():null), telefono:(p.telefono?String(p.telefono).trim():null), activo:true };
      var id=p.id;
      if(id){ var r=await sb.from('proveedores').update(payload).eq('id',id); if(r.error) throw r.error; }
      else {
        var ex=await sb.from('proveedores').select('id').eq('nombre',nombre).maybeSingle();
        if(ex.data){ var u=await sb.from('proveedores').update(payload).eq('id',ex.data.id); if(u.error) throw u.error; id=ex.data.id; }
        else { var ins=await sb.from('proveedores').insert(payload).select('id').single(); if(ins.error) throw ins.error; id=ins.data.id; }
      }
      _provId=null;
      // Asignación a locales (al crear o si se pasa explícito)
      if(p.locales && p.locales.length){
        var m=await sucIdMap();
        await sb.from('proveedor_locales').delete().eq('proveedor_id',id);
        var rows=p.locales.map(function(l){ return { proveedor_id:id, sucursal_id:(typeof l==='number'?l:(m[l]||null)) }; }).filter(function(x){return x.sucursal_id;});
        if(rows.length){ var ri=await sb.from('proveedor_locales').insert(rows); if(ri.error) throw ri.error; }
      }
      return {ok:true,id:id};
    },
    setProveedorLocales: async function(p){
      var id=p.proveedorId||p.id; if(!id) throw new Error('Falta proveedor');
      var m=await sucIdMap();
      await sb.from('proveedor_locales').delete().eq('proveedor_id',id);
      var rows=(p.locales||[]).map(function(l){ return { proveedor_id:id, sucursal_id:(typeof l==='number'?l:(m[l]||null)) }; }).filter(function(x){return x.sucursal_id;});
      if(rows.length){ var r=await sb.from('proveedor_locales').insert(rows); if(r.error) throw r.error; }
      return {ok:true};
    },
    eliminarProveedor: async function(p){
      if(!p.id) throw new Error('Falta id'); var r=await sb.from('proveedores').delete().eq('id',p.id);
      if(r.error){ var u=await sb.from('proveedores').update({activo:false}).eq('id',p.id); if(u.error) throw u.error; _provId=null; return {ok:true,soft:true}; }
      _provId=null; return {ok:true};
    },
    // --- COMPRAS ---
    registrarCompra: async function(p){
      var c=p.compra||p;
      if(!c.sucursal_id && c.sucursal){ var m=await sucIdMap(); c.sucursal_id=m[c.sucursal]||null; }
      if(!c.proveedor_id && c.proveedor){ var pm=await provIdMap(); c.proveedor_id=pm[c.proveedor]||null; }
      var r=await sb.rpc('registrar_compra',{ p:c }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    // --- GASTOS ---
    guardarGasto: async function(p){
      var m=await sucIdMap();
      var pay={ sucursal_id:(p.sucursal?m[p.sucursal]:(p.sucursalId||null)), destinatario_id:(p.destinatario?m[p.destinatario]:(p.destinatarioId||null)), categoria_gasto_id:(p.categoriaId||null), proveedor_id:(p.proveedorId||null), monto:(p.monto===''||p.monto==null?0:Number(p.monto)), forma_pago:(p.formaPago||null), fondo:fondoDeForma(p.formaPago), comprobante:(p.comprobante||null), descripcion:(p.descripcion||null) };
      // Fecha sin hora (YYYY-MM-DD): si el gasto es de HOY se sella con el momento
      // real (now) para que caiga dentro de la ventana de la caja abierta
      // (apertura→ahora) y así impacte en el cierre. Si es de otro día, se ancla al
      // mediodía de Argentina (día calendario correcto, sin afectar la caja de hoy).
      if(p.fecha){
        if(String(p.fecha).length===10){
          var hoyAR=new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'});
          pay.fecha=(p.fecha===hoyAR)?new Date().toISOString():(p.fecha+'T12:00:00-03:00');
        } else { pay.fecha=p.fecha; }
      }
      if(p.id){ var r=await sb.from('gastos').update(pay).eq('id',p.id); if(r.error) throw r.error; return {ok:true,id:p.id}; }
      var ins=await sb.from('gastos').insert(pay).select('id').single(); if(ins.error) throw ins.error; return {ok:true,id:ins.data.id};
    },
    eliminarGasto: async function(p){ if(!p.id) throw new Error('Falta id'); var r=await sb.from('gastos').delete().eq('id',p.id); if(r.error) throw r.error; return {ok:true}; },
    // --- ELABORACIÓN ---
    registrarElaboracion: async function(p){
      var e=p.elaboracion||p;
      if(!e.sucursal_id && e.sucursal){ var m=await sucIdMap(); e.sucursal_id=m[e.sucursal]||null; }
      var r=await sb.rpc('registrar_elaboracion',{ p:e }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    // --- REMITOS INTERNOS ---
    emitirRemito: async function(p){
      var e=p.remito||p; var m=await sucIdMap();
      if(!e.origen_id && e.origen) e.origen_id=m[e.origen]||null;
      if(!e.destino_id && e.destino) e.destino_id=m[e.destino]||null;
      var r=await sb.rpc('emitir_remito',{ p:e }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    recibirRemito: async function(p){
      var payload={ remito_id:p.id }; if(p.recepciones) payload.recepciones=p.recepciones;
      var r=await sb.rpc('recibir_remito',{ p:payload }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    procesarRemito: async function(p){
      var payload={ remito_id:p.id, accion:p.accion, detalle_ids:p.detalle_ids||[] };
      if(p.accion==='redirigir'){ var m=await sucIdMap(); payload.nuevo_destino_id=p.nuevo_destino_id||(p.nuevoDestino?m[p.nuevoDestino]:null); }
      if(p.motivo) payload.motivo=p.motivo;
      var r=await sb.rpc('remito_procesar',{ p:payload }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    redirigirRemito: async function(p){
      var m=await sucIdMap(); var nid=p.nuevo_destino_id||(p.nuevoDestino?m[p.nuevoDestino]:null);
      var r=await sb.rpc('redirigir_remito',{ p:{ remito_id:p.id, nuevo_destino_id:nid } }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    rechazarRemito: async function(p){
      var r=await sb.rpc('rechazar_remito',{ p:{ remito_id:p.id, motivo:p.motivo||null } }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    anularRemito: async function(p){
      var r=await sb.rpc('anular_remito',{ p:{ remito_id:p.id, motivo:p.motivo||null } }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    // --- CUENTAS ---
    registrarPagoCC: async function(p){
      var m=await sucIdMap();
      var recibeId=(p.sucursal?m[p.sucursal]:null);
      var pay={ cliente_id:p.clienteId, sucursal_id:recibeId, tipo:(p.tipo||'pago'), monto:Number(p.monto)||0, forma_pago:(p.formaPago||null), concepto:(p.concepto||(p.tipo==='cargo'?'Cargo':'Pago')), observaciones:(p.observaciones||null) };
      var r=await sb.from('cuenta_corriente').insert(pay);
      if(r.error && /observ/i.test(r.error.message||'')){ delete pay.observaciones; r=await sb.from('cuenta_corriente').insert(pay); }  // columna sin crear: guardar sin observaciones
      if(r.error) throw r.error;
      // Cuenta financiera entre locales: si el pago lo recibió un local != administrador del cliente,
      // el local que cobró le debe esa plata al local administrador (dueño de la cuenta).
      if(recibeId && (p.tipo||'pago')!=='cargo' && (Number(p.monto)||0)>0){
        var c=await sb.from('clientes').select('administrador_suc_id').eq('id',p.clienteId).maybeSingle();
        var adminId=c.data&&c.data.administrador_suc_id;
        if(adminId && adminId!==recibeId){
          await sb.from('cuentas_internas').insert({ local_origen:recibeId, local_destino:adminId, tipo:'cobro_cta_cte', concepto:'Cobró cta cte de cliente de otro local', monto:Number(p.monto)||0, ref:('cliente:'+p.clienteId) });
        }
      }
      return {ok:true};
    },
    // Saldo ENTRE GRUPOS. Cada movimiento se resuelve a grupo: grupo_* si está
    // cargado (entregas/tarjetas/liquidación), si no se deriva del local vía su grupo.
    // Se descartan los movimientos internos de un mismo grupo (misma bolsa).
    getCuentasInternas: async function(){
      var r=await sb.from('cuentas_internas').select('local_origen,local_destino,grupo_origen,grupo_destino,fecha,tipo,concepto,monto').order('fecha',{ascending:false}).limit(500);
      if(r.error) throw r.error;
      var gm=await grupoMap();
      var rg=await sb.from('grupos').select('id,nombre'); var gname={}; (rg.data||[]).forEach(function(g){ gname[g.id]=g.nombre; });
      var movs=(r.data||[]).map(function(x){
        var go = x.grupo_origen  || gm[x.local_origen]  || null;
        var gd = x.grupo_destino || gm[x.local_destino] || null;
        return { origenId:go, destinoId:gd, origen:(gname[go]||''), destino:(gname[gd]||''), fecha:x.fecha, tipo:x.tipo, concepto:x.concepto||'', monto:Number(x.monto)||0 };
      }).filter(function(m){ return m.origenId && m.destinoId && String(m.origenId)!==String(m.destinoId); });
      return {ok:true, movimientos:movs, grupos:gname};
    },
    // Grupos + sus locales (para ABM y selectores). cobrador = recibe lo no-efectivo.
    getGrupos: async function(){
      var rg=await sb.from('grupos').select('id,nombre,cobra_no_efectivo,activo').order('nombre');
      if(rg.error) throw rg.error;
      var rs=await sb.from('sucursales').select('id,nombre,grupo_id,activo');
      if(rs.error) throw rs.error;
      var locs=(rs.data||[]).filter(function(s){ return s.activo!==false; });
      var grupos=(rg.data||[]).filter(function(g){ return g.activo!==false; }).map(function(g){
        return { id:g.id, nombre:g.nombre, cobrador:!!g.cobra_no_efectivo,
                 locales: locs.filter(function(s){ return s.grupo_id===g.id; }).map(function(s){ return {id:s.id, nombre:s.nombre}; }) };
      });
      var sinGrupo = locs.filter(function(s){ return !s.grupo_id; }).map(function(s){ return {id:s.id, nombre:s.nombre}; });
      return {ok:true, grupos:grupos, sinGrupo:sinGrupo};
    },
    // deudor paga al acreedor → saldar deuda entre locales
    registrarLiquidacion: async function(p){
      var m=await sucIdMap(); var deu=(typeof p.deudor==='number')?p.deudor:m[p.deudor], acr=(typeof p.acreedor==='number')?p.acreedor:m[p.acreedor];
      if(!deu||!acr) throw new Error('Locales inválidos');
      var r=await sb.from('cuentas_internas').insert({ local_origen:acr, local_destino:deu, tipo:'liquidacion', concepto:(p.concepto||'Liquidación / pago entre locales'), monto:Number(p.monto)||0 });
      if(r.error) throw r.error; return {ok:true};
    },
    // Entrega de dinero entre GRUPOS. Semántica: "origina" = quien da la plata,
    // "recibe" = quien la recibe. En cuentas_internas origen=quien debe, destino=acreedor,
    // así que el que RECIBE la plata queda debiéndole al que la ORIGINA (y si había deuda
    // al revés, la compensa). Sirve igual para saldar un saldo mostrado (el deudor "origina"
    // el pago al acreedor).
    registrarEntregaGrupo: async function(p){
      var origina=Number(p.origina), recibe=Number(p.recibe);
      if(!origina || !recibe || origina===recibe) throw new Error('Elegí dos grupos distintos (quién entrega y quién recibe)');
      var monto=Number(p.monto)||0; if(!(monto>0)) throw new Error('Monto inválido');
      var r=await sb.from('cuentas_internas').insert({ grupo_origen:recibe, grupo_destino:origina, tipo:(p.tipo||'entrega'), concepto:(p.concepto||'Entrega de dinero entre grupos'), monto:monto });
      if(r.error) throw r.error; return {ok:true};
    },
    // ABM de grupos de locales.
    guardarGrupo: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('Falta el nombre del grupo');
      if(p.id){ var r=await sb.from('grupos').update({nombre:nombre}).eq('id',p.id); if(r.error) throw r.error; _grpMap=null; return {ok:true, id:p.id}; }
      var ins=await sb.from('grupos').insert({nombre:nombre}).select('id').single(); if(ins.error) throw ins.error; _grpMap=null; return {ok:true, id:ins.data.id};
    },
    eliminarGrupo: async function(p){
      if(!p || !p.id) throw new Error('Falta el grupo');
      await sb.from('sucursales').update({grupo_id:null}).eq('grupo_id',p.id);   // desasigna sus locales
      var r=await sb.from('grupos').delete().eq('id',p.id); if(r.error) throw r.error; _grpMap=null; return {ok:true};
    },
    // Asigna (o saca) un local a un grupo.
    setLocalGrupo: async function(p){
      if(!p || !p.sucursalId) throw new Error('Falta el local');
      var r=await sb.from('sucursales').update({grupo_id:(p.grupoId||null)}).eq('id',p.sucursalId); if(r.error) throw r.error; _grpMap=null; return {ok:true};
    },
    // Marca un grupo como el único cobrador de lo no-efectivo (apaga el resto).
    setGrupoCobrador: async function(p){
      if(!p || !p.id) throw new Error('Falta el grupo');
      await sb.from('grupos').update({cobra_no_efectivo:false}).neq('id',p.id);
      var r=await sb.from('grupos').update({cobra_no_efectivo:true}).eq('id',p.id); if(r.error) throw r.error; return {ok:true};
    },
    registrarPagoProveedor: async function(p){
      var m=await sucIdMap();
      var fondo=fondoDeForma(p.formaPago);
      var pay={ proveedor_id:(p.proveedorId||null), cuenta_id:(p.cuentaId||null), sucursal_id:(p.sucursal?m[p.sucursal]:null), tipo:(p.tipo||'pago'), monto:Number(p.monto)||0, forma_pago:(p.formaPago||null), fondo:fondo, descripcion:(p.descripcion||(p.tipo==='cargo'?'Cargo':'Pago')), observaciones:(p.observaciones||null) };
      var r=await sb.from('deuda_proveedores').insert(pay).select('id').single();
      if(r.error && /observ/i.test(r.error.message||'')){ delete pay.observaciones; r=await sb.from('deuda_proveedores').insert(pay).select('id').single(); }  // columna sin crear: guardar sin observaciones
      if(r.error) throw r.error;
      var deudaId=(r.data?r.data.id:null);
      // Si se paga desde la Caja guardada (reserva), descontar la reserva del local.
      if((p.tipo||'pago')==='pago' && fondo==='reserva' && pay.sucursal_id && (Number(p.monto)||0)>0){
        await sb.from('efectivo_reserva_mov').insert({ sucursal_id:pay.sucursal_id, tipo:'egreso', monto:Number(p.monto)||0, concepto:'Pago a proveedor' });
      }
      // Pago a proveedor CROSS-GROUP: si el grupo de este local paga una cuenta cuyos
      // locales pertenecen todos a OTRO grupo, ese grupo le queda debiendo lo pagado.
      // (Solo el caso claro: la cuenta es de un único grupo distinto al que paga. Si la
      //  cuenta es junta entre varios grupos no se asienta — el reparto sería ambiguo.)
      if((p.tipo||'pago')==='pago' && pay.cuenta_id && pay.sucursal_id && (Number(p.monto)||0)>0){
        try{
          var gm=await grupoMap();
          var grupoPaga=gm[pay.sucursal_id];
          var rl=await sb.from('proveedor_cuenta_locales').select('sucursal_id').eq('cuenta_id',pay.cuenta_id);
          var gset={}; (rl.data||[]).forEach(function(x){ var g=gm[x.sucursal_id]; if(g) gset[String(g)]=g; });
          var gids=Object.keys(gset);
          if(gids.length===1 && String(gset[gids[0]])!==String(grupoPaga)){
            await sb.from('cuentas_internas').insert({ grupo_origen:gset[gids[0]], grupo_destino:grupoPaga, tipo:'pago_proveedor_cruzado', concepto:'Pago de cuenta de proveedor de otro grupo', monto:Number(p.monto)||0, ref:('deuda:'+deudaId) });
          }
        }catch(e){ /* si el cruce falla, el pago igual quedó registrado */ }
      }
      // Cheques emitidos (forma de pago cheque): se guardan para el listado y quedan
      // vinculados al pago (deuda_id) para poder anularlos/revertirlos juntos.
      if((p.tipo||'pago')==='pago' && Array.isArray(p.cheques) && p.cheques.length){
        var chrows=p.cheques.map(function(c){ return { proveedor_id:(p.proveedorId||null), sucursal_id:pay.sucursal_id, banco:((c.banco||'').toString().trim()||null), numero:((c.numero||'').toString().trim()||null), fecha_pago:(c.fecha||null), monto:Number(c.monto)||0, estado:'emitido', concepto:(p.descripcion||'Pago a proveedor'), deuda_id:deudaId }; });
        var rc=await sb.from('cheques').insert(chrows);
        if(rc.error){
          if(/deuda_id/i.test(rc.error.message||'')){  // columna sin crear: guardar sin el vínculo
            var chrows2=chrows.map(function(x){ var y=Object.assign({},x); delete y.deuda_id; return y; });
            var rc2=await sb.from('cheques').insert(chrows2);
            if(rc2.error) return {ok:true, warn:'El pago se registró, pero no se pudieron guardar los cheques: '+rc2.error.message};
            return {ok:true, warn:'Cheques guardados sin vínculo al pago — corré alter_cheques_deuda.sql para poder anularlos automáticamente.'};
          }
          return {ok:true, warn:'El pago se registró, pero no se pudieron guardar los cheques (¿falta correr cheques_schema.sql?): '+rc.error.message};
        }
      }
      return {ok:true};
    },
    // Borra un movimiento de cuenta de proveedor (cargo manual o pago). Mismo acceso que cargarlo.
    // Si el pago salió de la Caja guardada (reserva), se repone la reserva; sus cheques (deuda_id)
    // se borran en cascada. Los movimientos de compra/gasto se anulan en su origen.
    eliminarMovProveedor: async function(p){
      if(!p||!p.id) throw new Error('Falta el id del movimiento');
      var g=await sb.from('deuda_proveedores').select('id,proveedor_id,sucursal_id,tipo,monto,forma_pago,fondo,descripcion').eq('id',p.id).maybeSingle();
      if(g.error) throw g.error; if(!g.data) return {ok:false, error:'No se encontró el movimiento'};
      var mov=g.data; var des=(mov.descripcion||'');
      if(des==='Compra' || des==='Pago en la compra' || /^Gasto a cuenta/i.test(des)){
        return {ok:false, error:'Este movimiento viene de una compra o gasto. Borralo o anulalo desde Compras o Gastos.'};
      }
      var d=await sb.from('deuda_proveedores').delete().eq('id',p.id); if(d.error) throw d.error;
      // Revertir el cruce cross-group de este pago, si lo hubo (atado por ref=deuda:<id>).
      try{ await sb.from('cuentas_internas').delete().eq('tipo','pago_proveedor_cruzado').eq('ref','deuda:'+p.id); }catch(e){}
      if((mov.tipo||'')==='pago' && mov.fondo==='reserva' && mov.sucursal_id && (Number(mov.monto)||0)>0){
        await sb.from('efectivo_reserva_mov').insert({ sucursal_id:mov.sucursal_id, tipo:'ingreso', monto:Number(mov.monto)||0, concepto:'Reversa pago a proveedor (borrado)' });
      }
      return {ok:true};
    },
    // Anula un cheque: si está vinculado a un pago, revierte ese pago (lo borra; sus
    // cheques se van en cascada y, si salió de la Caja guardada, se repone la reserva).
    // Si es un cheque viejo sin vínculo, solo lo marca 'anulado'.
    anularCheque: async function(p){
      if(!p||!p.id) throw new Error('Falta el id del cheque');
      var c=await sb.from('cheques').select('*').eq('id',p.id).maybeSingle();
      if(c.error) throw c.error; if(!c.data) return {ok:false, error:'No se encontró el cheque'};
      var ch=c.data;
      if(ch.deuda_id!=null){
        var g=await sb.from('deuda_proveedores').select('id,sucursal_id,tipo,monto,fondo').eq('id',ch.deuda_id).maybeSingle();
        if(!g.error && g.data){
          var mov=g.data;
          var d=await sb.from('deuda_proveedores').delete().eq('id',mov.id); if(d.error) throw d.error;  // cascada: borra los cheques del pago
          if((mov.tipo||'')==='pago' && mov.fondo==='reserva' && mov.sucursal_id && (Number(mov.monto)||0)>0){
            await sb.from('efectivo_reserva_mov').insert({ sucursal_id:mov.sucursal_id, tipo:'ingreso', monto:Number(mov.monto)||0, concepto:'Reversa pago a proveedor (cheque anulado)' });
          }
          return {ok:true, pagoRevertido:true};
        }
      }
      var u=await sb.from('cheques').update({estado:'anulado'}).eq('id',p.id); if(u.error) throw u.error;
      return {ok:true, soloCheque:true};
    },
    guardarCuentaProveedor: async function(p){
      var m=await sucIdMap(); var payload={ proveedor_id:p.proveedorId, nombre:(p.nombre||null) }; var cid=p.id;
      if(cid){ var r=await sb.from('proveedor_cuentas').update(payload).eq('id',cid); if(r.error) throw r.error; }
      else { var ins=await sb.from('proveedor_cuentas').insert(payload).select('id').single(); if(ins.error) throw ins.error; cid=ins.data.id; }
      await sb.from('proveedor_cuenta_locales').delete().eq('cuenta_id',cid);
      var locs=(p.locales||[]).map(function(l){ return (typeof l==='number')?l:(m[l]||null); }).filter(Boolean);
      if(locs.length){ var rows=locs.map(function(sid){ return {cuenta_id:cid, sucursal_id:sid}; }); var rl=await sb.from('proveedor_cuenta_locales').insert(rows); if(rl.error) throw rl.error; }
      return {ok:true, id:cid};
    },
    eliminarCuentaProveedor: async function(p){
      if(!p.id) throw new Error('Falta id'); var r=await sb.from('proveedor_cuentas').delete().eq('id',p.id);
      if(r.error){ var u=await sb.from('proveedor_cuentas').update({activo:false}).eq('id',p.id); if(u.error) throw u.error; return {ok:true,soft:true}; } return {ok:true};
    },
    // Define la cuenta COMPARTIDA (junta) de un proveedor = locales que comparten el saldo.
    // locales con < 2 elementos => el proveedor queda separado por local (se borra la junta).
    setCuentaJunta: async function(p){
      var pid=p.proveedorId; if(!pid) throw new Error('Falta proveedor');
      var m=await sucIdMap();
      var sids=(p.locales||[]).map(function(l){ return (typeof l==='number')?l:(m[l]||null); }).filter(Boolean);
      // borrar cuenta(s) junta previas de este proveedor
      var ex=await sb.from('proveedor_cuentas').select('id').eq('proveedor_id',pid);
      var ids=(ex.data||[]).map(function(x){return x.id;});
      if(ids.length){ await sb.from('proveedor_cuenta_locales').delete().in('cuenta_id',ids); var del=await sb.from('proveedor_cuentas').delete().in('id',ids); if(del.error){ await sb.from('proveedor_cuentas').update({activo:false}).in('id',ids); } }
      if(sids.length>=2){
        var nombre=(p.locales||[]).join('+');
        var ins=await sb.from('proveedor_cuentas').insert({ proveedor_id:pid, nombre:nombre, activo:true }).select('id').single(); if(ins.error) throw ins.error;
        var rows=sids.map(function(s){ return { cuenta_id:ins.data.id, sucursal_id:s }; });
        var rl=await sb.from('proveedor_cuenta_locales').insert(rows); if(rl.error) throw rl.error;
        return {ok:true, id:ins.data.id};
      }
      return {ok:true, id:null};
    },
    // --- CATEGORÍAS DE GASTO / REPARTO ---
    guardarCategoriaGasto: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('Falta el nombre');
      var payload={ nombre:nombre, grupo:(p.grupo?String(p.grupo).trim():null) };
      if(p.id){ var r=await sb.from('categorias_gasto').update(payload).eq('id',p.id); if(r.error) throw r.error; return {ok:true,id:p.id}; }
      var ex=await sb.from('categorias_gasto').select('id').eq('nombre',nombre).maybeSingle();
      if(ex.data){ var u=await sb.from('categorias_gasto').update(payload).eq('id',ex.data.id); if(u.error) throw u.error; return {ok:true,id:ex.data.id}; }
      var ins=await sb.from('categorias_gasto').insert(payload).select('id').single(); if(ins.error) throw ins.error; return {ok:true,id:ins.data.id};
    },
    eliminarCategoriaGasto: async function(p){
      if(!p.id) throw new Error('Falta id'); await sb.from('reparto_gastos').delete().eq('categoria_gasto_id',p.id);
      var r=await sb.from('categorias_gasto').delete().eq('id',p.id); if(r.error) throw r.error; return {ok:true};
    },
    guardarReparto: async function(p){
      var pay={ categoria_gasto_id:p.categoriaId, sucursal_id:p.sucursalId, porcentaje:(p.porcentaje===''||p.porcentaje==null?0:Number(p.porcentaje)) };
      var r=await sb.from('reparto_gastos').upsert(pay,{onConflict:'categoria_gasto_id,sucursal_id'}); if(r.error) throw r.error; return {ok:true};
    },
    // --- CAJA / RESERVA ---
    abrirCaja: async function(p){
      var m=await sucIdMap(); var sid=m[p.sucursal]; if(!sid) throw new Error('Local inválido');
      // Idempotente por local: si ya hay caja abierta (otra PC), se suma a esa. Atómico server-side.
      var r=await sb.rpc('abrir_caja',{ p_sucursal:sid, p_cajero:(p.cajero||null), p_apertura:(Number(p.apertura)||0) });
      if(r.error) throw r.error;
      var d=r.data||{}; return {ok:true, id:d.id, yaAbierta:!!d.ya_abierta, creada:!!d.creada, cajero:d.cajero||'', apertura:Number(d.apertura)||0};
    },
    cerrarCaja: async function(p){
      var r=await sb.rpc('cerrar_caja',{ p_caja_id:p.id, p_contado:Number(p.contado)||0, p_queda:Number(p.queda)||0, p_reserva:Number(p.reserva)||0,
        p_clover_sistema:(p.cloverSistema==null||p.cloverSistema===''?null:Number(p.cloverSistema)),
        p_clover_informado:(p.cloverInformado==null||p.cloverInformado===''?null:Number(p.cloverInformado)) });
      if(r.error) throw r.error;
      // Cruce diario al grupo cobrador (Clover neto + Virtual). No rompe el cierre si falla.
      try{ await generarCruceCloverVirtual(p.id); }catch(e){}
      return r.data||{ok:true};
    },
    reabrirCaja: async function(p){
      var r=await sb.rpc('reabrir_caja',{ p_caja_id:p.id }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    eliminarCaja: async function(p){
      var r=await sb.rpc('eliminar_caja',{ p_caja_id:p.id }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    movReserva: async function(p){
      var m=await sucIdMap(); var sid=m[p.sucursal]; if(!sid) throw new Error('Local inválido');
      var r=await sb.from('efectivo_reserva_mov').insert({ sucursal_id:sid, tipo:(p.tipo||'ingreso'), monto:Number(p.monto)||0, concepto:(p.concepto||null) });
      if(r.error) throw r.error; return {ok:true};
    },
    // --- SUCURSALES / LOCALES ---
    guardarSucursal: async function(p){
      var nombre=String(p.nombre||'').trim(); if(!nombre) throw new Error('Falta el nombre del local');
      var payload={ nombre:nombre, sigla:(p.sigla?String(p.sigla).trim():null), direccion:(p.direccion?String(p.direccion).trim():null), telefono:(p.telefono?String(p.telefono).trim():null), activo:true };
      if(p.activo!=null) payload.activo=!!p.activo;
      if(p.id){ var r=await sb.from('sucursales').update(payload).eq('id',p.id); if(r.error) throw r.error; }
      else {
        var ex=await sb.from('sucursales').select('id').eq('nombre',nombre).maybeSingle();
        if(ex.data){ var r2=await sb.from('sucursales').update(payload).eq('id',ex.data.id); if(r2.error) throw r2.error; }
        else { var r3=await sb.from('sucursales').insert(payload); if(r3.error) throw r3.error; }
      }
      _sucId=null; return {ok:true};
    },
    eliminarSucursal: async function(p){
      var m=await sucIdMap(); var id=p.id||(p.nombre?m[p.nombre]:null); if(!id) throw new Error('Local no encontrado');
      await sb.from('balanzas').delete().eq('sucursal_id',id);   // se borra también la balanza
      var r=await sb.from('sucursales').delete().eq('id',id);
      if(r.error){ var u=await sb.from('sucursales').update({activo:false}).eq('id',id); if(u.error) throw u.error; _sucId=null; return {ok:true, soft:true}; }
      _sucId=null; return {ok:true};
    },
    // --- BALANZAS ---
    guardarBalanza: async function(p){
      var b=p.balanza||p; var m=await sucIdMap(); var sid=b.sucursal_id||m[b.sucursal];
      if(!sid) throw new Error('Sucursal no encontrada: '+(b.sucursal||''));
      var r=await sb.from('balanzas').upsert({ sucursal_id:sid, prefijo:String(b.prefijo||'20'), dato:String(b.dato||'precio'), codlen:parseInt(b.codlen)||5, datolen:parseInt(b.datolen)||5 }, { onConflict:'sucursal_id' });
      if(r.error) throw r.error; return {ok:true};
    },
    eliminarBalanza: async function(p){
      var m=await sucIdMap(); var id=p.sucursal_id||(p.sucursal?m[p.sucursal]:null); if(!id) throw new Error('Local no encontrado');
      var r=await sb.from('balanzas').delete().eq('sucursal_id',id); if(r.error) throw r.error; return {ok:true};
    },
    // --- VENTAS ---
    // Registra la venta completa y atómica vía RPC registrar_venta.
    // Acepta { venta:{...} } o el objeto de venta directo. Resuelve sucursal_id por nombre/sigla si falta.
    registrarVenta: async function(p){
      var v=p.venta||p;
      if(!v.sucursal_id && (v.sucursal||v.sucursal_nombre)){ var m=await sucIdMap(); v.sucursal_id=m[v.sucursal||v.sucursal_nombre]||null; }
      if(!v.sucursal_id) throw new Error('No se pudo resolver la sucursal de la venta');
      if(!v.lista_id && v.lista){ var lm=await listaIdMap(); v.lista_id=lm[v.lista]||null; }
      var r=await sb.rpc('registrar_venta', { p_venta:v });
      if(r.error) throw r.error;
      return r.data || {ok:true};
    },
    anularVenta: async function(p){
      var r=await sb.rpc('anular_venta', { p_venta_id:p.id, p_autorizado:!!p.autorizado });
      if(r.error) throw r.error;
      return r.data || {ok:true};
    },

    // --- CLOVER (conciliación) ---
    // Guarda merchant_id+token por local. NO usa .select() → el token nunca vuelve al navegador.
    guardarCloverCuenta: async function(p){
      var sid=p.sucursal_id; if(!sid && p.sucursal){ var m=await sucIdMap(); sid=m[p.sucursal]; }
      if(!sid) throw new Error('Local no encontrado');
      if(!p.merchant_id || !p.token) throw new Error('Faltan Merchant ID o token');
      var r=await sb.from('clover_cuentas').upsert({ sucursal_id:sid, merchant_id:String(p.merchant_id).trim(), token:String(p.token).trim(), activo:true, actualizado:new Date().toISOString() }, { onConflict:'sucursal_id' });
      if(r.error) throw r.error; return {ok:true};
    },
    eliminarCloverCuenta: async function(p){
      var sid=p.sucursal_id; if(!sid && p.sucursal){ var m=await sucIdMap(); sid=m[p.sucursal]; }
      if(!sid) throw new Error('Local no encontrado');
      var r=await sb.from('clover_cuentas').delete().eq('sucursal_id',sid); if(r.error) throw r.error; return {ok:true};
    },
    guardarCloverArancel: async function(p){
      if(!p.medio) throw new Error('Falta el medio');
      var r=await sb.from('clover_aranceles').upsert({ medio:String(p.medio).trim(), arancel_pct:Number(p.arancel_pct)||0, dias_acreditacion:parseInt(p.dias)||0, nota:p.nota||null }, { onConflict:'medio' });
      if(r.error) throw r.error; return {ok:true};
    },
    eliminarCloverArancel: async function(p){
      var r=await sb.from('clover_aranceles').delete().eq('medio',p.medio); if(r.error) throw r.error; return {ok:true};
    },

    // --- COMPRAS EN DOS ETAPAS (borradores) ---
    crearCompra: async function(p){
      var c=p.compra||p; var m=await sucIdMap(); var sid=c.sucursal_id||(c.sucursal?m[c.sucursal]:null);
      var r=await sb.rpc('compra_crear',{p:{ sucursal_id:sid, proveedor_id:c.proveedor_id||null, cuenta_id:c.cuenta_id||null, comprobante:c.comprobante||null, total:c.total||0, pago_monto:c.pago_monto||0, forma_pago:c.forma_pago||null }});
      if(r.error) throw r.error; return r.data||{ok:true};
    },
    editarCompra: async function(p){
      var r=await sb.rpc('compra_editar',{p:{ compra_id:p.id, comprobante:p.comprobante, total:p.total, cuenta_id:p.cuenta_id, pago_monto:p.pago_monto, forma_pago:p.forma_pago }});
      if(r.error) throw r.error; return r.data||{ok:true};
    },
    agregarItemCompra: async function(p){
      var r=await sb.rpc('compra_item_agregar',{p:{ compra_id:p.compra_id, codigo:p.codigo||null, producto_id:p.producto_id||null, cantidad:p.cantidad, costo_unit:p.costo_unit }});
      if(r.error) throw r.error; return r.data||{ok:true};
    },
    quitarItemCompra: async function(p){
      var r=await sb.rpc('compra_item_quitar',{p:{ detalle_id:p.detalle_id }}); if(r.error) throw r.error; return r.data||{ok:true};
    },
    confirmarCompra: async function(p){
      var r=await sb.rpc('compra_confirmar',{p:{ compra_id:p.id }}); if(r.error) throw r.error; return r.data||{ok:true};
    },
    descartarCompra: async function(p){
      var r=await sb.rpc('compra_descartar',{p:{ compra_id:p.id }}); if(r.error) throw r.error; return r.data||{ok:true};
    },
    reabrirCompra: async function(p){ var r=await sb.rpc('compra_reabrir',{p:{ compra_id:p.id }}); if(r.error) throw r.error; return r.data||{ok:true}; },
    anularCompra: async function(p){ var r=await sb.rpc('compra_anular',{p:{ compra_id:p.id }}); if(r.error) throw r.error; return r.data||{ok:true}; },

    // --- HISTÓRICO DE VENTAS DIARIO ---
    // Upsert por (sucursal_id, fecha): cargar de nuevo un día lo PISA, nunca lo duplica.
    // Espera { filas:[{local, fecha(yyyy-mm-dd), monto, clientes}] }.
    upsertHistorico: async function(p){
      var filas=(p&&p.filas)||[]; if(!filas.length) throw new Error('No hay filas para cargar');
      var m=await sucIdMap(); var rows=[], errores=[];
      filas.forEach(function(f,idx){
        var sid=m[f.local]||m[String(f.local||'').trim()];
        if(!sid){ errores.push('Fila '+(idx+1)+': local desconocido "'+f.local+'"'); return; }
        if(!/^\d{4}-\d{2}-\d{2}$/.test(String(f.fecha||''))){ errores.push('Fila '+(idx+1)+': fecha inválida'); return; }
        rows.push({ sucursal_id:sid, fecha:f.fecha, monto:Number(f.monto)||0, clientes:parseInt(f.clientes)||0, origen:'carga-manual' });
      });
      if(errores.length) throw new Error(errores.join(' | '));
      var r=await sb.from('ventas_historico_diario').upsert(rows, { onConflict:'sucursal_id,fecha' });
      if(r.error) throw r.error;
      return {ok:true, cargadas:rows.length};
    }
  };

  // ---------------- DISPATCH ----------------
  window.sf = async function(action, qs){
    var a = parseAction(action);
    if(qs){ String(qs).split('&').forEach(function(p){ var kv=p.split('='); a.params[kv[0]]=decodeURIComponent(kv[1]||''); }); }
    var fn = readers[a.base];
    if(!fn) return { ok:false, error:'Lectura no implementada aún en Supabase: '+a.base };
    try{ return await fn(a.params); }catch(e){ return { ok:false, error:String(e.message||e) }; }
  };

  window.sp = async function(action, payload){
    var fn = writers[action];
    if(!fn) return { ok:false, error:'Escritura pendiente de portar a Supabase: '+action };
    try{ return await fn(payload||{}); }catch(e){ return { ok:false, error:String(e.message||e) }; }
  };
})();
