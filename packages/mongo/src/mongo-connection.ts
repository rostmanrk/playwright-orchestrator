import { injectable, inject, preDestroy } from 'inversify';
import type { CreateArgs } from './create-args.js';
import { MongoClient, Db } from 'mongodb';
import { MONGO_CONFIG } from './symbols.js';

@injectable()
export class MongoConnection {
    readonly client: MongoClient;
    readonly db: Db;

    constructor(@inject(MONGO_CONFIG) args: CreateArgs) {
        const {
            connectionString,
            db,
            tls,
            tlsCA,
            tlsKey,
            tlsKeyPassword,
            tlsPassphrase,
            tlsAllowInvalidCertificates,
            tlsAllowInvalidHostnames,
            tlsInsecure,
        } = args;
        this.client = new MongoClient(connectionString, {
            tls,
            tlsCAFile: tlsCA,
            tlsCertificateKeyFile: tlsKey,
            tlsCertificateKeyFilePassword: tlsKeyPassword,
            passphrase: tlsPassphrase,
            tlsAllowInvalidCertificates,
            tlsAllowInvalidHostnames,
            tlsInsecure,
        });
        this.db = this.client.db(db);
    }

    @preDestroy()
    async dispose(): Promise<void> {
        await this.client.close();
    }
}
