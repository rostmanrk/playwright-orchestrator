export interface CreateArgs {
    connectionString: string;
    tableNamePrefix: string;
    sslCa?: string | Buffer;
    sslCert?: string | Buffer;
    sslKey?: string | Buffer;
}
