import { Pool } from 'pg';
export declare const pool: Pool;
/**
* Automatically reads and executes the schema.sql file to set up or update database tables.
* Throws an error if the migration process fails.
*/
export declare function migrate(): Promise<void>;
//# sourceMappingURL=db.d.ts.map