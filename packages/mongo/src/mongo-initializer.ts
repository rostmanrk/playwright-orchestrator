import { injectable, inject } from 'inversify';
import type { Initializer } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { MongoConnection } from './mongo-connection.js';
import { MONGO_CONFIG, MONGO_CONNECTION } from './symbols.js';

@injectable()
export class MongoInitializer implements Initializer {
    constructor(
        @inject(MONGO_CONFIG) private readonly config: CreateArgs,
        @inject(MONGO_CONNECTION) private readonly connection: MongoConnection,
    ) {}

    async initialize(): Promise<void> {
        const { collectionNamePrefix } = this.config;
        const runsCollection = `${collectionNamePrefix}_test_runs`;
        const testsCollection = `${collectionNamePrefix}_tests`;
        const testsInfoCollection = `${collectionNamePrefix}_tests_info`;
        const database = this.connection.db;
        const collections = await database.collections();
        const set = new Set(collections.map((c) => c.collectionName));
        await Promise.all([
            !set.has(runsCollection)      ? database.createCollection(runsCollection) : Promise.resolve(),
            !set.has(testsCollection)     ? database.createCollection(testsCollection)
                                                .then(c => c.createIndex({ status: 1 })) : Promise.resolve(),
            !set.has(testsInfoCollection) ? database.createCollection(testsInfoCollection) : Promise.resolve(),
        ]);
    }
}
