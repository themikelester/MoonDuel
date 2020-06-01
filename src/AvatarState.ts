export enum AvatarState {
  None = 0,
  AttackSide,
  AttackVertical,
  AttackPunch,
  AttackThrow,
  Struck
};

export interface StateDefinition {
  duration: number
  attackPeriod: number[],
  safePeriod: number[],
  safeFrom?: AvatarState,
};