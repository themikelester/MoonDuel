import { AvatarController } from "./AvatarController";
import { AvatarRender } from "./AvatarRender";
import { Renderer } from "./gfx/GfxTypes";
import { ResourceManager } from "./resources/ResourceLoading";
import { Clock } from "./Clock";
import { Camera } from "./Camera";

interface Dependencies {
    gfxDevice: Renderer;
    resources: ResourceManager;
    clock: Clock;
    camera: Camera;
}

export class AvatarSystem {
    private controller: AvatarController = new AvatarController();
    private renderer: AvatarRender = new AvatarRender();

    initialize(game: Dependencies) {
        this.controller.initialize();
        this.renderer.initialize(game);
    }

    update(game: Dependencies) {
        this.controller.update();
        this.renderer.update(game);
    }

    render(game: Dependencies) {
        this.renderer.render(game);
    }
}