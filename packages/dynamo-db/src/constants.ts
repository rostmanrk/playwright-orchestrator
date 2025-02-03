export const OFFSET_STEP = 100_000_000;

export enum StatusOffset {
    Pending = 0,
    Running = 1 * OFFSET_STEP,
    Succeed = 2 * OFFSET_STEP,
    Failed = 3 * OFFSET_STEP,
}

// Describe the fields of the DynamoDB table. Field names are shortened to save space.
export enum Fields {
    Id = 'pk',
    Order = 'sk',
    Line = 'l',
    Character = 'c',
    File = 'f',
    Project = 'p',
    Timeout = 't',
    Duration = 'd',
    EMA = 'e',
    Version = 'v',
    History = 'h',
    Updated = 'u',
    Status = 's',
    Report = 'r',
    Window = 'w',
    Title = 'ti',
    Fails = 'fl',
    LastSuccess = 'ls',
    Ttl = 'ttl',
    Config = 'cfg',
    Created = 'cr',
}
