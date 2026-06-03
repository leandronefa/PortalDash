import sql from 'mssql';
import 'dotenv/config';
const pool = await new sql.ConnectionPool({user:process.env.SQL_USER,password:process.env.SQL_PASS,server:process.env.SQL_HOST,database:process.env.SQL_DB,options:{encrypt:false,trustServerCertificate:true}}).connect();
const r = await pool.query("SELECT TOP 3 * FROM cgd_vendedores");
console.log('cols:', Object.keys(r.recordset[0]||{}).join(', '));
console.log('sample:', JSON.stringify(r.recordset.slice(0,3)));
await pool.close();
