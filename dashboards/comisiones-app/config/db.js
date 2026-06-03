const sql = require('mssql');

const dbConfig = {
    server: '10.0.0.115',
    user: 'sa',
    password: 'MicroS123',
    database: 'db_Cegid',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let pool = null;

async function getPool() {
    if (!pool) {
        pool = await sql.connect(dbConfig);
    }
    return pool;
}

module.exports = { getPool, sql };
