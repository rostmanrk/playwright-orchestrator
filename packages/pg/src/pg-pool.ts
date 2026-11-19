import { injectable, inject, preDestroy } from 'inversify';
import type { CreateArgs } from './create-args.js';
import pg from 'pg';
import { PG_CONFIG } from './symbols.js';

@injectable()
export class PgPool {
    readonly pool: pg.Pool;

    constructor(@inject(PG_CONFIG) { connectionString, sslCa, sslCert, sslKey }: CreateArgs) {
        const config: pg.PoolConfig = { connectionString };
        config.ssl = sslCa || sslCert || sslKey ? {} : undefined;
        if (sslCa) config.ssl!.ca = sslCa;
        if (sslCert && sslKey) {
            config.ssl!.cert = sslCert;
            config.ssl!.key = sslKey;
        }
        this.pool = new pg.Pool(config);
        // Without listeners Node treats connection errors as uncaught and exits. The pool drops a broken
        // connection and opens a new one, so errors only need logging.
        // Errors from idle connections are re-emitted on the pool.
        this.pool.on('error', (error) => {
            console.error(`Postgres connection error: ${error.message}`);
        });
        // Connections in use emit on themselves; their queries already reject with the error.
        this.pool.on('connect', (client) => {
            client.on('error', () => {});
        });
    }

    @preDestroy()
    async dispose(): Promise<void> {
        if (this.pool.ending) return;
        await this.pool.end();
    }
}
