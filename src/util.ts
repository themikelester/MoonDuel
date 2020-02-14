
export function assert(b: boolean, message: string = ""): void {
    if (!b) {
        console.error(new Error().stack);
        throw new Error(`Assert fail: ${message}`);
    }
}

export function assertDefined<T>(v: T | null | undefined, msg?: string): T {
    if (v !== undefined && v !== null)
        return v;
    else
        throw new Error(defaultValue(msg, "Missing object"));
}

export function defaultValue<T>(v: T | undefined, fallback: T): T {
    return (v !== undefined && v !== null) ? v : fallback;
}

export function defined<T>(v: T | undefined): boolean {
    return v !== undefined && v !== null;
}

// Remove the element at index n from an array
export function arrayRemove<T>(L: T[], n: T): number {
    const idx = L.indexOf(n);
    assert(idx >= 0);
    L.splice(idx, 1);
    return idx;
}

// Create an array of length n and initialize each element with the constructor c 
export function nArray<T>(n: number, c: () => T): T[] {
    const d = new Array(n);
    for (let i = 0; i < n; i++)
        d[i] = c();
    return d;
}