import { injectable, inject, preDestroy } from 'inversify';
import type { CreateArgs } from './create-args.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DYNAMO_CONFIG } from './symbols.js';

@injectable()
export class DynamoDbConnection {
    readonly client: DynamoDBClient;
    readonly docClient: DynamoDBDocumentClient;

    constructor(@inject(DYNAMO_CONFIG) { endpointUrl }: CreateArgs) {
        this.client = new DynamoDBClient({ endpoint: endpointUrl, maxAttempts: 10 });
        this.docClient = DynamoDBDocumentClient.from(this.client, {
            marshallOptions: { removeUndefinedValues: true },
        });
    }

    @preDestroy()
    async dispose(): Promise<void> {
        this.client.destroy();
    }
}
