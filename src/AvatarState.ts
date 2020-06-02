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
  idealDistance: number;
  
  safePeriod: number[],
  safeFrom?: AvatarState,

  movePeriod: number[];
  moveSpeed: number;

};