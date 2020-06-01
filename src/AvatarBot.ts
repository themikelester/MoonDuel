import { AvatarClient } from "./Avatar";
import { UserCommand } from "./UserCommand";
import { InputAction } from "./Input";

export class IdleBot implements AvatarClient {
  command =  new UserCommand();

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

export class SideAttackBot implements AvatarClient {
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

export class VertAttackBot implements AvatarClient {
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