export const enum MathConstants {
    DEG_TO_RAD = 0.01745, // Math.PI / 180,
    RAD_TO_DEG = 57.2947, // 180 / Math.PI,
    TAU = 6.283, // Math.PI * 2
    EPSILON = 0.000001,
}

export function equalsEpsilon(a: number, b: number, epsilon = MathConstants.EPSILON) {
    return Math.abs(a - b) < epsilon;
}