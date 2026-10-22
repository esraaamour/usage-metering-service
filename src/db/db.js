import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
// Initialize the PostgreSQL connection pool using environment variables or a default local fallback
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/metering',
    max: Number(process.env.DB_POOL_MAX ?? 20),
});
/**
* Automatically reads and executes the schema.sql file to set up or update database tables.
* Throws an error if the migration process fails.
*/
export async function migrate() {
    try {
        // Read the schema.sql file relative to this file's directory.  
        const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
        // Execute the SQL statemants against the database
        await pool.query(sql);
        console.log('Database migration executed successfully.');
    }
    catch (error) {
        console.error('Migration failed:', error);
        throw error;
    }
}
//# sourceMappingURL=db.js.map