export interface CreateArgs {
    connectionString: string;
    tableNamePrefix: string;
    sslProfile?: string;
    sslCa?: string | Buffer;
    sslCert?: string | Buffer;
    sslKey?: string | Buffer;
    sslPassphrase?: string;
    sslRejectUnauthorized?: boolean;
    sslVerifyServerCertificate?: boolean;
}
