const fs = require('fs');
const path = require('path');

/**
 * Borrador clave→valor persistido en disco, agrupado por mes (un archivo por
 * mes: data-store/<prefix>-202609.json). Se usa para el borrador de carga de
 * objetivos del "mes que viene" (prefix "objetivos") y para Días Venta /
 * Margen% de la pestaña "Por Empresa" (prefix "margenes") — mismo mecanismo,
 * dos instancias independientes.
 *
 * Escritura atómica (temporal + rename), mismo patrón que ControlCaja.
 */
function crearStoreObjetivos({ dir, prefix = 'objetivos' }) {
  function archivoDe(mes) {
    return path.join(dir, `${prefix}-${mes}.json`);
  }

  function leer(mes) {
    const p = archivoDe(mes);
    if (!fs.existsSync(p)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      console.error(`[VentaObjetivo] borrador corrupto en ${p}, se descarta: ${err.message}`);
      return {};
    }
  }

  function guardarTodo(mes, datos) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = archivoDe(mes);
    const tmp = path.join(dir, `${prefix}-${mes}.json.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
    fs.renameSync(tmp, p);
  }

  function guardarUno(mes, codSucursal, valores) {
    const datos = leer(mes);
    datos[codSucursal] = { ...valores, ts: new Date().toISOString() };
    guardarTodo(mes, datos);
    return datos[codSucursal];
  }

  function eliminarUno(mes, codSucursal) {
    const datos = leer(mes);
    if (!(codSucursal in datos)) return;
    delete datos[codSucursal];
    guardarTodo(mes, datos);
  }

  function limpiarMes(mes) {
    const p = archivoDe(mes);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  return { leer, guardarUno, eliminarUno, limpiarMes };
}

module.exports = { crearStoreObjetivos };
