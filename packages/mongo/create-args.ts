export interface CreateArgs {
    connectionString: string;
    db: string;
    collectionNamePrefix: string;
    tls?: boolean;
    debug?: boolean;
}
