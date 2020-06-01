import { AvatarState, StateDefinition } from "./AvatarState";
import { Avatar } from "./Avatar";
import { Weapon } from "./Weapon";
import { assertDefined } from "./util";

class VerticalAttack implements StateDefinition {
  attackPeriod = [36, 46];
  safePeriod = [9, 36];
  duration = 90;
}

class SideAttack implements StateDefinition {
  attackPeriod = [36, 46];
  safePeriod = [9, 36];
  duration = 90;
}

class PunchAttack implements StateDefinition {
  attackPeriod = [36, 46];
  safePeriod = [9, 36];
  duration = 90;
}

const kDefinitions: Partial<Record<AvatarState, StateDefinition>> = {
  [AvatarState.AttackVertical]: new VerticalAttack(),
  [AvatarState.AttackSide]: new SideAttack(),
  [AvatarState.AttackPunch]: new PunchAttack(),
}

export class Attack {
  instigator: Avatar;
  weapon: Weapon;
  
  type: AvatarState;
  def: StateDefinition;

  constructor (instigator: Avatar, type: AvatarState) {
    this.instigator = instigator;
    this.weapon = assertDefined(instigator.weapon);
    this.type = type;
    this.def = assertDefined(kDefinitions[type]);
  }
}