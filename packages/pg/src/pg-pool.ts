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
    }

    @preDestroy()
    async dispose(): Promise<void> {
        if (this.pool.ending) return;
        await this.pool.end();
    }
}
