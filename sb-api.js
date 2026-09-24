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
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  window.sbClient = sb;

  function hoyISO(){ return new Date().toISOString().slice(0,10); }
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
      var res = await sb.from('combos').select('id,nombre,activo,locales,comp:combo_componentes(minimo,precio_promo,peso_unitario,prod:productos(codigo_interno))');
      if(res.error) throw res.error;
      return {ok:true, combos:(res.data||[]).filter(function(c){return c.activo!==false;}).map(function(c){
        return { id:c.id, nombre:c.nombre, locales:c.locales||'todos',
          componentes:(c.comp||[]).map(function(k){ return { codigo:k.prod?k.prod.codigo_interno:'', minimo:Number(k.minimo)||0, precioPromo:Number(k.precio_promo)||0, pesoUnitario:(k.peso_unitario==null?'':Number(k.peso_unitario)) }; }) };
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
      if(params.desde) q=q.gte('fecha', params.desde);
      if(params.hasta) q=q.lte('fecha', params.hasta+'T23:59:59');
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
    getRoles: async function(){
      var r=await sb.from('roles').select('id,nombre,activo').order('id'); if(r.error) throw r.error;
      var rp=await sb.from('rol_permisos').select('rol_id,permiso'); var byRol={}; (rp.data||[]).forEach(function(x){ (byRol[x.rol_id]=byRol[x.rol_id]||[]).push(x.permiso); });
      return {ok:true, roles:(r.data||[]).filter(function(x){return x.activo!==false;}).map(function(x){ return { id:x.id, nombre:x.nombre, permisos:byRol[x.id]||[] }; })};
    },
    getPerfiles: async function(){
      var r=await sb.from('perfiles').select('id,email,nombre,activo,rol_id,rol:roles(nombre)').order('email'); if(r.error) throw r.error;
      var ul=await sb.from('usuario_locales').select('perfil_id,sucursal_id'); var byP={}; (ul.data||[]).forEach(function(x){ (byP[x.perfil_id]=byP[x.perfil_id]||[]).push(x.sucursal_id); });
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      return {ok:true, perfiles:(r.data||[]).filter(function(p){return p.activo!==false;}).map(function(p){ return { id:p.id, email:p.email, nombre:p.nombre||'', rolId:p.rol_id, rol:(p.rol?p.rol.nombre:''), locales:(byP[p.id]||[]).map(function(id){return idToName[id]||id;}), localesIds:(byP[p.id]||[]) }; })};
    },
    getMiPerfil: async function(){
      var u=await sb.auth.getUser(); var email=(u.data&&u.data.user&&u.data.user.email)||null;
      var cnt=await sb.from('perfiles').select('id',{count:'exact',head:true}); if(cnt.error) throw cnt.error;
      if((cnt.count||0)===0) return {ok:true, bootstrap:true, esAdmin:true, permisos:['*'], locales:[], rol:'Administrador (inicial)', email:email};
      if(!email) return {ok:true, esAdmin:false, permisos:[], locales:[], rol:null, email:null};
      var pr=await sb.from('perfiles').select('id,nombre,activo,rol_id,rol:roles(nombre)').eq('email',email).maybeSingle(); if(pr.error) throw pr.error;
      var perfil=pr.data;
      if(!perfil || perfil.activo===false) return {ok:true, esAdmin:false, permisos:[], locales:[], rol:null, email:email, sinPerfil:true};
      var permisos=[]; if(perfil.rol_id){ var rp=await sb.from('rol_permisos').select('permiso').eq('rol_id',perfil.rol_id); permisos=(rp.data||[]).map(function(x){return x.permiso;}); }
      var locs=await sb.from('usuario_locales').select('sucursal_id').eq('perfil_id',perfil.id);
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      var locales=(locs.data||[]).map(function(x){ return idToName[x.sucursal_id]||x.sucursal_id; });
      return {ok:true, esAdmin:(permisos.indexOf('*')>=0), permisos:permisos, locales:locales, rol:(perfil.rol?perfil.rol.nombre:null), nombre:perfil.nombre, email:email};
    },
    getProveedores: async function(){
      var r=await sb.from('proveedores').select('id,nombre,cuit,email,telefono,activo').order('nombre'); if(r.error) throw r.error;
      return {ok:true, proveedores:(r.data||[]).filter(function(p){return p.activo!==false;}).map(function(p){ return { id:p.id, nombre:p.nombre, cuit:p.cuit||'', email:p.email||'', telefono:p.telefono||'' }; })};
    },
    getGastos: async function(params){
      var q=sb.from('gastos').select('id,fecha,monto,descripcion,forma_pago,comprobante,sucursal_id,destinatario_id,categoria_gasto_id,proveedor_id,cat:categorias_gasto(nombre,grupo),prov:proveedores(nombre)').order('fecha',{ascending:false});
      q=q.limit(params&&params.limit?parseInt(params.limit):300);
      var r=await q; if(r.error) throw r.error;
      return {ok:true, gastos:(r.data||[]).map(function(g){ return { id:g.id, fecha:g.fecha, monto:Number(g.monto)||0, descripcion:g.descripcion||'', formaPago:g.forma_pago||'', comprobante:g.comprobante||'', sucursalId:g.sucursal_id, destinatarioId:g.destinatario_id, categoriaId:g.categoria_gasto_id, proveedorId:g.proveedor_id, categoria:g.cat?g.cat.nombre:'', grupo:g.cat?g.cat.grupo:'', proveedor:g.prov?g.prov.nombre:'' }; })};
    },
    getMovimientosCC: async function(params){
      var id=params&&params.id; if(!id) return {ok:true, movimientos:[], saldo:0};
      var r=await sb.from('cuenta_corriente').select('fecha,tipo,monto,concepto,comprobante,forma_pago').eq('cliente_id',id).order('fecha'); if(r.error) throw r.error;
      var saldo=0; var movs=(r.data||[]).map(function(m){ var v=Number(m.monto)||0; if(/pago/i.test(m.tipo)) saldo-=v; else saldo+=v; return { fecha:m.fecha, tipo:m.tipo, monto:v, concepto:m.concepto||'', comprobante:m.comprobante||'', formaPago:m.forma_pago||'', saldo:saldo }; });
      return {ok:true, movimientos:movs, saldo:saldo};
    },
    getMovProveedor: async function(params){
      var id=params&&params.id; if(!id) return {ok:true, movimientos:[], saldo:0};
      var r=await sb.from('deuda_proveedores').select('fecha,tipo,monto,descripcion,comprobante,forma_pago').eq('proveedor_id',id).order('fecha'); if(r.error) throw r.error;
      var saldo=0; var movs=(r.data||[]).map(function(m){ var v=Number(m.monto)||0; if(/pago/i.test(m.tipo)) saldo-=v; else saldo+=v; return { fecha:m.fecha, tipo:m.tipo, monto:v, descripcion:m.descripcion||'', comprobante:m.comprobante||'', formaPago:m.forma_pago||'', saldo:saldo }; });
      return {ok:true, movimientos:movs, saldo:saldo};
    },
    getRemitos: async function(){
      var r=await sb.from('remitos_internos').select('id,numero,origen_id,destino_id,estado,concepto,total_costo,fecha_emision,fecha_recepcion').order('fecha_emision',{ascending:false}).limit(300);
      if(r.error) throw r.error;
      return {ok:true, remitos:(r.data||[]).map(function(x){ return { id:x.id, numero:x.numero, origenId:x.origen_id, destinoId:x.destino_id, estado:x.estado, concepto:x.concepto||'', total:Number(x.total_costo)||0, emision:x.fecha_emision, recepcion:x.fecha_recepcion }; })};
    },
    getRemitoDetalle: async function(params){
      var id=params&&params.id; if(!id) throw new Error('Falta remito');
      var d=await sb.from('remitos_detalle').select('id,nombre,cantidad_emitida,cantidad_recibida,costo_unit,plus_pct,precio_remito_unit,categoria').eq('remito_id',id); if(d.error) throw d.error;
      return {ok:true, detalle:(d.data||[]).map(function(x){ return { id:x.id, nombre:x.nombre, cantidad:Number(x.cantidad_emitida)||0, recibida:x.cantidad_recibida, costo:Number(x.costo_unit)||0, plus:Number(x.plus_pct)||0, precio:Number(x.precio_remito_unit)||0, categoria:x.categoria||'' }; })};
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
    getCajas: async function(params){
      var m=await sucIdMap(); var q=sb.from('cajas').select('id,sucursal_id,cajero,apertura,abierta_at,cerrada,cerrada_at,esperado,cierre_efectivo,diferencia,a_reserva,queda_caja').order('abierta_at',{ascending:false}).limit(100);
      if(params&&params.sucursal){ var sid=m[params.sucursal]; if(sid) q=q.eq('sucursal_id',sid); }
      var r=await q; if(r.error) throw r.error;
      var sn=await sb.from('sucursales').select('id,nombre'); var idToName={}; (sn.data||[]).forEach(function(s){ idToName[s.id]=s.nombre; });
      return {ok:true, cajas:(r.data||[]).map(function(c){ return { id:c.id, local:idToName[c.sucursal_id]||'', cajero:c.cajero||'', apertura:Number(c.apertura)||0, abiertaAt:c.abierta_at, cerrada:c.cerrada, cerradaAt:c.cerrada_at, esperado:Number(c.esperado)||0, contado:Number(c.cierre_efectivo)||0, diferencia:Number(c.diferencia)||0, aReserva:Number(c.a_reserva)||0, quedaCaja:Number(c.queda_caja)||0 }; })};
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
    }
  };

  // ---------------- ESCRITURAS ----------------
  function hoy(){ return new Date().toISOString().slice(0,10); }
  var _listaId=null, _catId=null;
  async function listaIdMap(){ if(_listaId) return _listaId; var r=await sb.from('listas_precio').select('id,nombre'); _listaId={}; (r.data||[]).forEach(function(l){ _listaId[l.nombre]=l.id; }); return _listaId; }
  async function catIdMap(){ if(_catId) return _catId; var r=await sb.from('categorias').select('id,nombre'); _catId={}; (r.data||[]).forEach(function(c){ _catId[c.nombre]=c.id; }); return _catId; }
  var _sucId=null;
  async function sucIdMap(){ if(_sucId) return _sucId; var r=await sb.from('sucursales').select('id,nombre,sigla'); _sucId={}; (r.data||[]).forEach(function(s){ _sucId[s.nombre]=s.id; if(s.sigla) _sucId[s.sigla]=s.id; }); return _sucId; }
  var _provId=null;
  async function provIdMap(){ if(_provId) return _provId; var r=await sb.from('proveedores').select('id,nombre'); _provId={}; (r.data||[]).forEach(function(p){ _provId[p.nombre]=p.id; }); return _provId; }
  async function prodIdPorCod(cod){ var r=await sb.from('productos').select('id').eq('codigo_interno',String(cod)).maybeSingle(); return (r.data&&r.data.id)||null; }
  async function catIdOrCreate(nombre){ if(!nombre) return null; var m=await catIdMap(); if(m[nombre]) return m[nombre]; var ins=await sb.from('categorias').insert({nombre:nombre}).select('id').single(); if(ins.error) throw ins.error; _catId[nombre]=ins.data.id; return ins.data.id; }

  var writers = {
    // --- PRODUCTOS ---
    setCostoProducto: async function(p){
      var r=await sb.from('productos').update({ costo:(p.costo===''?null:Number(p.costo)), fecha_costo:hoy() }).eq('codigo_interno',String(p.codigo));
      if(r.error) throw r.error; return {ok:true};
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
    setProductoActivo: async function(p){
      var r=await sb.from('productos').update({ activo:!!p.activo }).eq('codigo_interno',String(p.codigo));
      if(r.error) throw r.error; return {ok:true};
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
      for(var i=0;i<filas.length;i++){
        var f=filas[i]; var cod=String(f.codigo||'').trim(); if(!cod) continue;
        try{
          var cid=await catIdOrCreate(f.categoria||'');
          var prod={ nombre:f.nombre||'', marca:f.marca||'', categoria_id:cid, tipo:(f.tipo==='unidad'?'unidad':'pesable'),
            costo:(f.costo===''||f.costo==null?null:Number(f.costo)), margen_override:(f.margen===''||f.margen==null?null:Number(f.margen)) };
          prod.fecha_costo=(prod.costo!=null?hoy():null);
          var ex=await sb.from('productos').select('id').eq('codigo_interno',cod).maybeSingle();
          var pid;
          if(ex.data){ var u=await sb.from('productos').update(prod).eq('id',ex.data.id); if(u.error) throw u.error; pid=ex.data.id; actualizados++; }
          else { prod.codigo_interno=cod; prod.activo=true; var ins=await sb.from('productos').insert(prod).select('id').single(); if(ins.error) throw ins.error; pid=ins.data.id; creados++; }
          var rows=[]; Object.keys(f.precios||{}).forEach(function(l){ var v=Number(f.precios[l]); if(lm[l] && v>0) rows.push({ producto_id:pid, lista_id:lm[l], precio:v, fecha:hoy() }); });
          if(rows.length){ var pr=await sb.from('producto_precios').upsert(rows,{onConflict:'producto_id,lista_id'}); if(pr.error) throw pr.error; }
        }catch(e){ errores.push(cod+': '+(e.message||e)); }
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
      var ins=await sb.from('combos').insert({ nombre:p.nombre, activo:true, locales:(p.locales||'todos') }).select('id').single();
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
    guardarPerfil: async function(p){
      var email=String(p.email||'').trim().toLowerCase(); if(!email) throw new Error('Falta el email');
      var m=await sucIdMap(); var payload={ email:email, nombre:(p.nombre||null), rol_id:(p.rolId||null) }; var pid=p.id;
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
      if(p.id){ var r=await sb.from('proveedores').update(payload).eq('id',p.id); if(r.error) throw r.error; _provId=null; return {ok:true,id:p.id}; }
      var ex=await sb.from('proveedores').select('id').eq('nombre',nombre).maybeSingle();
      if(ex.data){ var u=await sb.from('proveedores').update(payload).eq('id',ex.data.id); if(u.error) throw u.error; _provId=null; return {ok:true,id:ex.data.id}; }
      var ins=await sb.from('proveedores').insert(payload).select('id').single(); if(ins.error) throw ins.error; _provId=null; return {ok:true,id:ins.data.id};
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
      var pay={ sucursal_id:(p.sucursal?m[p.sucursal]:(p.sucursalId||null)), destinatario_id:(p.destinatario?m[p.destinatario]:(p.destinatarioId||null)), categoria_gasto_id:(p.categoriaId||null), proveedor_id:(p.proveedorId||null), monto:(p.monto===''||p.monto==null?0:Number(p.monto)), forma_pago:(p.formaPago||null), fondo:(p.fondo||null), comprobante:(p.comprobante||null), descripcion:(p.descripcion||null) };
      if(p.fecha) pay.fecha=p.fecha;
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
    redirigirRemito: async function(p){
      var m=await sucIdMap(); var nid=p.nuevo_destino_id||(p.nuevoDestino?m[p.nuevoDestino]:null);
      var r=await sb.rpc('redirigir_remito',{ p:{ remito_id:p.id, nuevo_destino_id:nid } }); if(r.error) throw r.error; return r.data||{ok:true};
    },
    // --- CUENTAS ---
    registrarPagoCC: async function(p){
      var m=await sucIdMap();
      var recibeId=(p.sucursal?m[p.sucursal]:null);
      var pay={ cliente_id:p.clienteId, sucursal_id:recibeId, tipo:(p.tipo||'pago'), monto:Number(p.monto)||0, forma_pago:(p.formaPago||null), concepto:(p.concepto||(p.tipo==='cargo'?'Cargo':'Pago')) };
      var r=await sb.from('cuenta_corriente').insert(pay); if(r.error) throw r.error;
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
    getCuentasInternas: async function(){
      var r=await sb.from('cuentas_internas').select('local_origen,local_destino,fecha,tipo,concepto,monto').order('fecha',{ascending:false}).limit(500);
      if(r.error) throw r.error;
      return {ok:true, movimientos:(r.data||[]).map(function(x){ return { origenId:x.local_origen, destinoId:x.local_destino, fecha:x.fecha, tipo:x.tipo, concepto:x.concepto||'', monto:Number(x.monto)||0 }; })};
    },
    // deudor paga al acreedor → saldar deuda entre locales
    registrarLiquidacion: async function(p){
      var m=await sucIdMap(); var deu=(typeof p.deudor==='number')?p.deudor:m[p.deudor], acr=(typeof p.acreedor==='number')?p.acreedor:m[p.acreedor];
      if(!deu||!acr) throw new Error('Locales inválidos');
      var r=await sb.from('cuentas_internas').insert({ local_origen:acr, local_destino:deu, tipo:'liquidacion', concepto:(p.concepto||'Liquidación / pago entre locales'), monto:Number(p.monto)||0 });
      if(r.error) throw r.error; return {ok:true};
    },
    registrarPagoProveedor: async function(p){
      var m=await sucIdMap();
      var pay={ proveedor_id:(p.proveedorId||null), cuenta_id:(p.cuentaId||null), sucursal_id:(p.sucursal?m[p.sucursal]:null), tipo:(p.tipo||'pago'), monto:Number(p.monto)||0, forma_pago:(p.formaPago||null), fondo:(p.fondo||null), descripcion:(p.descripcion||(p.tipo==='cargo'?'Cargo':'Pago')) };
      var r=await sb.from('deuda_proveedores').insert(pay); if(r.error) throw r.error; return {ok:true};
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
      var ex=await sb.from('cajas').select('id').eq('sucursal_id',sid).eq('cerrada',false).maybeSingle();
      if(ex.data) throw new Error('Ya hay una caja abierta en este local');
      var ins=await sb.from('cajas').insert({ sucursal_id:sid, fecha:hoy(), cajero:(p.cajero||null), apertura:(Number(p.apertura)||0), abierta_at:new Date().toISOString(), cerrada:false }).select('id').single();
      if(ins.error) throw ins.error; return {ok:true, id:ins.data.id};
    },
    cerrarCaja: async function(p){
      var r=await sb.rpc('cerrar_caja',{ p_caja_id:p.id, p_contado:Number(p.contado)||0, p_queda:Number(p.queda)||0, p_reserva:Number(p.reserva)||0 });
      if(r.error) throw r.error; return r.data||{ok:true};
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
