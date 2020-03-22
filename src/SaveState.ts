import { CameraSystem } from "./CameraSystem";
import { defined } from "./util";
import { DebugMenu } from "./DebugMenu";
import { IS_DEVELOPMENT } from "./version";

const kStateVersion = 1;
const kStateStorageKey = 'state';

type StateModules = {
    cameraSystem: CameraSystem,
}

export class StateManager {
    clearing: boolean = false;

    initialize(modules: StateModules) {
        DebugMenu.add(this, 'clearState');

        const success = this.loadState(modules);
        if (success) console.log('Loaded state from localStorage');
    }

    saveState({ cameraSystem }: StateModules): void {
        const stateObj = {
            version: kStateVersion,
            cameraSystem,
            DebugMenu, 
        }
    
        const stateString = JSON.stringify(stateObj);

        // If clearState() has been called, ensure we don't save state until the page finishes reloading
        if (this.clearing) return; 

        window.localStorage.setItem(kStateStorageKey, stateString);
    }
    
    loadState({ cameraSystem }: StateModules): boolean {
        const stateString = window.localStorage.getItem(kStateStorageKey);
        if (!defined(stateString)) { return false; }
        
        const state = JSON.parse(stateString);
        
        // Don't bother trying load older state formats
        if (state.version !== kStateVersion) return false;
    
        try {
            cameraSystem.fromJSON(state.cameraSystem);
            DebugMenu.fromJSON(state.DebugMenu);
        } catch(e) {
            console.warn('Failed to load state:', e);
            return false;
        }
        
        return true
    }

    clearState() {
        window.localStorage.removeItem(kStateStorageKey);
        this.clearing = true;
        location.reload();
    }

    update(modules: StateModules) {
        if (IS_DEVELOPMENT) {
            this.saveState(modules);
        }
    }
}