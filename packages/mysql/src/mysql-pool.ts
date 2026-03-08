import { injectable, inject, preDestroy } from 'inversify';
import type { CreateArgs } from './create-args.js';
import { createPool, Pool, SslOptions } from 'mysql2/promise';
import { MYSQL_CONFIG } from './symbols.js';

@injectable()
export class MySQLPool {
    readonly pool: Pool;

    constructor(@inject(MYSQL_CONFIG) args: CreateArgs) {
        const { connectionString } = args;
        const url = new URL(connectionString);
        if (url.protocol !== 'mysql:') throw new Error('Invalid connection string');
        this.pool = createPool({
            host: url.hostname,
            port: Number(url.port),
            user: url.username,
            password: url.password,
            database: url.pathname.substring(1),
            ssl: createSslConfig(args),
            multipleStatements: true,
        });
    }

    @preDestroy()
    async dispose(): Promise<void> {
        await this.pool.end();
    }
}

function createSslConfig({
    sslCa,
    sslCert,
    sslKey,
    sslPassphrase,
    sslProfile,
    sslRejectUnauthorized,
    sslVerifyServerCertificate,
}: CreateArgs): SslOptions | string | undefined {
    if (!sslCa && !sslCert && !sslKey && !sslProfile) return undefined;
    return (
        sslProfile ?? {
            ca: sslCa,
            cert: sslCert,
            key: sslKey,
            passphrase: sslPassphrase,
            rejectUnauthorized: sslRejectUnauthorized,
            verifyIdentity: sslVerifyServerCertificate,
        }
    );
}
