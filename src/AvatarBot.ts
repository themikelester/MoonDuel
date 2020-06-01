import { AvatarClient, AvatarSystemServer, Avatar } from "./Avatar";
import { UserCommand } from "./UserCommand";
import { InputAction } from "./Input";
import { vec3 } from "gl-matrix";

export class AvatarBot implements AvatarClient {
  command =  new UserCommand();
  avatar: Avatar;

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
    return this.command;
  };
}

export class AvatarBotSystem {
  bots: AvatarBot[] = [];

  constructor(private avatarSystem: AvatarSystemServer, private avatars: Avatar[]) {}

  addBot(bot: AvatarBot, pos?: vec3) {
    const avatarIdx = this.avatarSystem.addAvatar(bot);
    bot.avatar = this.avatars[avatarIdx];
    if (pos) vec3.copy(bot.avatar.state.origin, pos);
    if (pos) vec3.normalize(bot.avatar.state.orientation, vec3.negate(bot.avatar.state.orientation, pos));
    this.bots.push(bot);
  }
}