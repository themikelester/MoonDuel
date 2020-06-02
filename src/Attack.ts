import { AvatarState, StateDefinition } from "./AvatarState";
import { Avatar } from "./Avatar";
import { Weapon } from "./Weapon";
import { assertDefined } from "./util";
import { Clock } from "./Clock";

class VerticalAttack implements StateDefinition {
  duration = 90;
  attackPeriod = [36, 44];
  safePeriod = [9, 36];
  safeFrom = AvatarState.AttackSide;

  movePeriod = [7, 43];
  idealDistance = 200;
  moveSpeed = 250;
}

class SideAttack implements StateDefinition {
  attackPeriod = [29, 46];
  safePeriod = [9, 36];
  duration = 90;
  safeFrom = AvatarState.AttackPunch;
  
  movePeriod = [20, 38];
  idealDistance = 150;
  moveSpeed = 50;
}

class PunchAttack implements StateDefinition {
  attackPeriod = [36, 46];
  safePeriod = [9, 36];
  duration = 90;
  safeFrom = AvatarState.AttackVertical;

  movePeriod = [20, 38];
  idealDistance = 150;
  moveSpeed = 50;
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

export function evaluateHit(avatar: Avatar, attack: Attack, clock: Clock): boolean {
  const dodgeFrame = (clock.simFrame - avatar.state.stateStartFrame);
  const dodgeType = avatar.attack ? avatar.attack.def.safeFrom : AvatarState.None;
  
  // Check to see if we are temporarily invulnerable to this attack type (dodging)
  if (dodgeType === attack.type) {
    const dodgePeriod = avatar.attack!.def.safePeriod;
    if (dodgeFrame >= dodgePeriod[0] && dodgeFrame <= dodgePeriod[1]) {
      return false;
    }
  } 

  // Don't allow consecutive hits by the same attack
  const alreadyHit = avatar.hitBy.includes(attack);
  if (alreadyHit) { return false }

  return true;
}