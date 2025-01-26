export interface CreateArgs {
    connectionString: string;
    db: string;
    collectionNamePrefix: string;
    tls?: boolean;
    tlsCA?: string;
    tlsCert?: string;
    tlsKey?: string;
    tlsPassphrase?: string;
    debug?: boolean;
}
