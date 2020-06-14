import { AvatarClient, AvatarSystemServer, Avatar } from "./Avatar";
import { UserCommand } from "./UserCommand";
import { InputAction } from "./Input";
import { vec3 } from "gl-matrix";
import { defined } from "./util";

export enum BotFlags {
  AutoTarget = 1 << 0, // When targeted, automatically target back 
}

export class AvatarBot implements AvatarClient {
  command =  new UserCommand();
  avatar: Avatar;
  avatars: Avatar[];
  flags: BotFlags;

  constructor(flags: BotFlags) {
    this.flags = flags;
  }

  getUserCommand(simFrame: number): UserCommand {
    this.command.frame = simFrame;
    this.command.headingX = 0;
    this.command.headingZ = 0;
    this.command.verticalAxis = 0;
    this.command.horizontalAxis = 0;
    this.command.actions = 0;
    return this.command;
  };
}

export class SideAttackBot extends AvatarBot {
  command =  new UserCommand();

  getUserCommand(simFrame: number): UserCommand {
    this.command.frame = simFrame;
    this.command.headingX = 0;
    this.command.headingZ = 0;
    this.command.verticalAxis = 0;
    this.command.horizontalAxis = 0;
    this.command.actions = InputAction.AttackSide;
    
    if (this.flags & BotFlags.AutoTarget) { autoTarget(this, simFrame); }
    
    return this.command;
  };
}

export class VertAttackBot extends AvatarBot {
  command =  new UserCommand();

  getUserCommand(simFrame: number): UserCommand {
    this.command.frame = simFrame;
    this.command.headingX = 0;
    this.command.headingZ = 0;
    this.command.verticalAxis = 0;
    this.command.horizontalAxis = 0;
    this.command.actions = InputAction.AttackVert;

    if (this.flags & BotFlags.AutoTarget) { autoTarget(this, simFrame); }

    return this.command;
  };
}

function autoTarget(bot: AvatarBot, simFrame: number) {
  const targetedBy = bot.avatars.find(a => a.target === bot.avatar);
  
  // Keep switching targets until we land on the which is targeting us
  if (defined(targetedBy) && !targetedBy.isBot) {
    // ... But we have to "release" the key in order for them to be interpreted as separate switch target commands
    if (bot.avatar.target != targetedBy && simFrame % 2 === 1) bot.command.actions |= InputAction.TargetLeft;
  } else {
    bot.command.actions |= InputAction.TargetRight
  }
}

export class AvatarBotSystem {
  bots: AvatarBot[] = [];

  constructor(private avatarSystem: AvatarSystemServer, private avatars: Avatar[]) {}

  addBot(bot: AvatarBot, pos?: vec3) {
    const avatarIdx = this.avatarSystem.addAvatar(bot);
    bot.avatars = this.avatars;
    bot.avatar = this.avatars[avatarIdx];
    bot.avatar.isBot = true;
    if (pos) vec3.copy(bot.avatar.state.origin, pos);
    if (pos) vec3.normalize(bot.avatar.state.orientation, vec3.negate(bot.avatar.state.orientation, pos));
    this.bots.push(bot);
  }
}