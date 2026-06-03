/*
 * install-dashboard-service.js
 * Registra un dashboard Node.js como Servicio de Windows (auto-arranque + reinicio).
 *
 * Uso:
 *   node install-dashboard-service.js "<NombreServicio>" "<CarpetaApp>" <PUERTO> [archivoEntrada]
 *
 *   [archivoEntrada] es opcional; por defecto "server.js".
 *   Ejemplos:
 *     node install-dashboard-service.js "Dash-Promociones" "C:\\apps\\dashboards\\DashPromocionesMP" 3002
 *     node install-dashboard-service.js "Dash-Sucursal" "C:\\apps\\dashboards\\sucursal-user-visualizer" 3003 "dist-server\\index.js"
 *
 * Requiere haber ejecutado antes:  npm install   (instala node-windows en esta carpeta)
 */
const path = require('path');
const fs = require('fs');
const { Service } = require('node-windows');

const name = process.argv[2];
const appDir = process.argv[3];
const port = process.argv[4];
const entry = process.argv[5] || 'server.js';

if (!name || !appDir || !port) {
  console.error('Uso: node install-dashboard-service.js "<NombreServicio>" "<CarpetaApp>" <PUERTO> [archivoEntrada]');
  process.exit(1);
}

const scriptPath = path.join(appDir, entry);
if (!fs.existsSync(scriptPath)) {
  console.error('ERROR: no existe el archivo de entrada: ' + scriptPath);
  console.error('       (para apps que compilan el server, use por ej. "dist-server\\index.js" y corra antes "npm run build:prod")');
  process.exit(1);
}

const svc = new Service({
  name: name,
  description: 'Dashboard Node.js (' + name + ') puerto ' + port + ' [' + entry + ']',
  script: scriptPath,
  workingDirectory: appDir,            // dotenv lee .env del directorio de trabajo
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT', value: String(port) }  // tiene prioridad sobre el PORT del .env
  ],
  wait: 2,
  grow: 0.5,
  maxRetries: 100
});

svc.on('install', function () {
  console.log('[' + name + '] instalado. Iniciando servicio...');
  svc.start();
});
svc.on('alreadyinstalled', function () {
  console.log('[' + name + '] ya existe. Borre la carpeta "daemon" de la app para reinstalar limpio.');
});
svc.on('start', function () {
  console.log('[' + name + '] EN EJECUCION  ->  http://0.0.0.0:' + port + '  (' + entry + ')');
});
svc.on('error', function (err) {
  console.error('[' + name + '] ERROR:', err);
});

svc.install();
