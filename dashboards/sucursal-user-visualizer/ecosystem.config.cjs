module.exports = {
  apps: [{
    name: 'sucursal-visualizer',
    script: 'C:/sucursal-user-visualizer/dist-server/index.js',
    interpreter: 'node',
    cwd: 'C:/sucursal-user-visualizer',
    out_file: 'C:/sucursal-user-visualizer/logs/pm2-out.log',
    error_file: 'C:/sucursal-user-visualizer/logs/pm2-err.log',
    time: true,
    restart_delay: 3000
  }]
};
