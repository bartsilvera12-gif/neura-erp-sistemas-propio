import pg from "pg";
const { Client } = pg;
const DB = process.env.DB_URL;
const c = new Client({ connectionString: DB });
await c.connect();
const q = process.argv[2];
const res = await c.query(q);
console.log(JSON.stringify(res.rows, null, 2));
await c.end();
