export interface CreateArgs {
    connectionString: string;
    db: string;
    collectionNamePrefix: string;
    tls?: boolean;
    tlsCA?: string;
    tlsKey?: string;
    tlsKeyPassword?: string;
    tlsPassphrase?: string;
    tlsAllowInvalidCertificates?: boolean;
    tlsAllowInvalidHostnames?: boolean;
    tlsInsecure?: boolean;
    debug?: boolean;
}
