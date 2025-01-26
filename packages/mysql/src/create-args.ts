export interface CreateArgs {
    connectionString: string;
    tableNamePrefix: string;
    sslProfile?: string;
    sslCa?: string;
    sslCert?: string;
    sslKey?: string;
    sslPassphrase?: string;
    sslRejectUnauthorized?: boolean;
    sslVerifyServerCertificate?: boolean;
}
