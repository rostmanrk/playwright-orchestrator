export interface CreateArgs {
    connectionString: string;
    tableNamePrefix: string;
    sslCa?: string;
    sslCert?: string;
    sslKey?: string;
}
