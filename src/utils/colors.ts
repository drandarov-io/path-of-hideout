export const PALETTE = [
    '#ff6b6b', '#4dabf7', '#51cf66', '#ffa94d', '#845ef7',
    '#15aabf', '#e64980', '#82c91e', '#fab005', '#228be6'
];

export function colorForIndex(i: number): string {
    return PALETTE[i % PALETTE.length];
}

export function indexForColor(color: string): number {
    const idx = PALETTE.indexOf(color.toLowerCase());
    if (idx >= 0) return idx;
    // try case-insensitive match
    const found = PALETTE.findIndex(c => c.toLowerCase() === color.toLowerCase());
    return found >= 0 ? found : 0;
}
