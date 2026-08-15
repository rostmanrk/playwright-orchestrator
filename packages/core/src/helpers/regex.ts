export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function makeGrepPattern(file: string, title: string): string {
    return `(?:^| )(?:\\S*/)?${escapeRegex(file)} (?:.*\\s)?${escapeRegex(title)}(?: @\\S+)*$`;
}
