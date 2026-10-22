/* ============================================================
   pdf-export.js — Exportación a PDF con la estética del POS.
   Requiere jsPDF (umd) + jspdf-autotable (cargados antes que este
   archivo). Lo usan Clientes, Cuentas (proveedores) y Stock para
   bajar estados de cuenta e historiales con el mismo look del
   sistema (navy del menú + azul de marca, tipografía sobria).

   API:
     POSPDF.tabla({
       titulo:   'Cuenta corriente',        // título grande del encabezado
       entidad:  'Juan Pérez',              // subtítulo (cliente/proveedor/local)
       metaLineas: ['Período: …', '12 mov'],// líneas chicas bajo el encabezado
       saldo:    1234,                       // número; + = debe, - = a favor
       saldoTipo:'cliente',                  // informativo (semántica igual)
       // (alternativa a saldo:) saldoTxt:'…', saldoColor:'bad'|'good'|'muted'
       columnas: ['Fecha','Concepto', …],
       filas:    [[ … ], [ … ]],             // strings ya formateados
       numericas:[3,4,5],                    // índices de columnas alineadas a la derecha
       landscape:false,
       archivo:  'ctacte_cliente.pdf'
     });
   ============================================================ */
(function(){
  // Paleta tomada 1:1 de estilos.css (:root) para que ligue con el sistema.
  var C={
    navy:[14,42,92], brand:[18,87,196], brand2:[47,123,230], ink:[34,38,46],
    soft:[246,248,252], line:[226,230,238], muted:[136,145,163],
    good:[46,125,79], bad:[192,57,43], softbrand:[231,240,254]
  };
  function getJsPDF(){ return (window.jspdf&&window.jspdf.jsPDF)||window.jsPDF||null; }
  function fmt$(n){ return '$'+Math.round(Number(n)||0).toLocaleString('es-AR'); }
  function ahora(){ return new Date().toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}); }

  // Encabezado branded (se dibuja en cada página vía didDrawPage).
  function dibujarCabecera(doc, o){
    var W=doc.internal.pageSize.getWidth();
    doc.setFillColor(C.navy[0],C.navy[1],C.navy[2]); doc.rect(0,0,W,64,'F');
    doc.setFillColor(C.brand[0],C.brand[1],C.brand[2]); doc.rect(0,64,W,3.5,'F');
    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
    doc.text('🥩 CARNICERÍA',40,24);
    doc.setFontSize(15); doc.text(String(o.titulo||''),40,45);
    if(o.entidad){ doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(214,227,250); doc.text(String(o.entidad),40,58); }
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(200,216,245);
    doc.text('Emitido '+ahora(), W-40, 24, {align:'right'});
  }
  // Pie con línea sutil y numeración.
  function dibujarPie(doc){
    var W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight();
    doc.setDrawColor(C.line[0],C.line[1],C.line[2]); doc.setLineWidth(0.5); doc.line(40,H-28,W-40,H-28);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(C.muted[0],C.muted[1],C.muted[2]);
    doc.text('Sistema POS — Carnicería', 40, H-15);
    var n; try{ n=doc.internal.getCurrentPageInfo().pageNumber; }catch(e){ n=doc.internal.getNumberOfPages(); }
    doc.text('Página '+n, W-40, H-15, {align:'right'});
  }

  function resolverSaldo(o){
    if(o.saldoTxt){ return { txt:o.saldoTxt, color:(C[o.saldoColor]||C.ink) }; }
    if(o.saldo==null || o.saldo==='') return null;
    var s=Number(o.saldo)||0;
    if(s>0.5) return { txt:'Debe '+fmt$(s), color:C.bad };
    if(s<-0.5) return { txt:fmt$(-s)+' a favor', color:C.good };
    return { txt:'Al día', color:C.muted };
  }

  var POSPDF={ fmt$:fmt$ };
  POSPDF.tabla=function(o){
    var JS=getJsPDF(); if(!JS){ alert('No se pudo cargar el generador de PDF.'); return; }
    var doc=new JS({ orientation:(o.landscape?'landscape':'portrait'), unit:'pt', format:'a4' });
    var W=doc.internal.pageSize.getWidth();

    // Bloque de contexto (meta + saldo) debajo del encabezado, solo en la 1ª página.
    var y=86;
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(C.muted[0],C.muted[1],C.muted[2]);
    (o.metaLineas||[]).forEach(function(l){ doc.text(String(l),40,y); y+=13; });

    var sal=resolverSaldo(o);
    if(sal){
      doc.setFont('helvetica','bold'); doc.setFontSize(11);
      var tw=doc.getTextWidth(sal.txt), pad=11, bw=tw+pad*2, bh=23, bx=W-40-bw, by=78;
      doc.setFillColor(C.softbrand[0],C.softbrand[1],C.softbrand[2]); doc.roundedRect(bx,by,bw,bh,5,5,'F');
      doc.setTextColor(sal.color[0],sal.color[1],sal.color[2]); doc.text(sal.txt, bx+pad, by+15);
    }

    var startY=Math.max(y, (sal?106:y))+4;
    var colStyles={};
    (o.numericas||[]).forEach(function(i){ colStyles[i]={ halign:'right' }; });

    doc.autoTable({
      startY:startY,
      head:[o.columnas||[]],
      body:o.filas||[],
      styles:{ font:'helvetica', fontSize:8.5, cellPadding:5, lineColor:C.line, lineWidth:0.5, textColor:C.ink, overflow:'linebreak' },
      headStyles:{ fillColor:C.brand, textColor:[255,255,255], fontStyle:'bold', fontSize:8.5, halign:'left' },
      alternateRowStyles:{ fillColor:C.soft },
      columnStyles:colStyles,
      margin:{ left:40, right:40, top:80 },
      didDrawPage:function(){ dibujarCabecera(doc,o); dibujarPie(doc); }
    });

    doc.save(o.archivo||'export.pdf');
  };

  window.POSPDF=POSPDF;
})();
