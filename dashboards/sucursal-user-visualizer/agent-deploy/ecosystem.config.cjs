module.exports = {
  apps: [{
    name: 'sucursal-agent',
    script: 'C:/agent/index.js',
    interpreter: 'node',
    cwd: 'C:/agent',
    out_file: 'C:/agent/logs/out.log',
    error_file: 'C:/agent/logs/err.log',
    time: true,
    restart_delay: 5000,
    env: {
      CENTRAL_URL: 'http://10.0.0.118:3003',
      AGENT_TOKEN: 'sucursal-agent-token',
      SERVER_ID: '10.104.12.38',
      PROCESSES: 'FileAppCliente.exe,DOAStatus.exe',
      INTERVAL_MS: '300000',
      PASSRESET_ENABLED: 'true',
      PASSRESET_SQL_SERVER: '10.0.0.115',
      PASSRESET_SQL_DB: 'db_Cegid',
      PASSRESET_SQL_USER: 'sa',
      PASSRESET_SQL_PASSWORD: 'MicroS123',
      PASSRESET_EXCLUDE_USERS: 'Administrador,Administrator,SYSTEM,DefaultAccount,WDAGUtilityAccount,Invitado,Guest'
    }
  }]
};
