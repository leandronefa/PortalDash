/*
 * uninstall-dashboard-service.js
 * Detiene y elimina el servicio de Windows de un dashboard. No borra archivos.
 *
 * Uso:
 *   node uninstall-dashboard-service.js "<NombreServicio>" "<CarpetaApp>"
 */
const path = require('path');
const { Service } = require('node-windows');

const name = process.argv[2];
const appDir = process.argv[3];

if (!name || !appDir) {
  console.error('Uso: node uninstall-dashboard-service.js "<NombreServicio>" "<CarpetaApp>"');
  process.exit(1);
}

const svc = new Service({
  name: name,
  script: path.join(appDir, 'server.js')
});

svc.on('uninstall', function () {
  console.log('[' + name + '] desinstalado.');
});
svc.on('error', function (err) {
  console.error('[' + name + '] ERROR:', err);
});

svc.uninstall();
