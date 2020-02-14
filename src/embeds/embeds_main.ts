class FsButton {
    public elem: HTMLElement;
    private hover: boolean = false;

    constructor() {
        this.elem = document.createElement('div');
        this.elem.style.border = '1px solid rgba(255, 255, 255, 0.4)';
        this.elem.style.borderRadius = '4px';
        this.elem.style.color = 'white';
        this.elem.style.position = 'absolute';
        this.elem.style.bottom = '8px';
        this.elem.style.right = '8px';
        this.elem.style.width = '32px';
        this.elem.style.height = '32px';
        this.elem.style.font = '130% bold sans-serif';
        this.elem.style.textAlign = 'center';
        this.elem.style.cursor = 'pointer';
        this.elem.onmouseover = () => {
            this.hover = true;
            this.style();
        };
        this.elem.onmouseout = () => {
            this.hover = false;
            this.style();
        };
        this.elem.onclick = this.onClick.bind(this);
        document.addEventListener('fullscreenchange', this.style.bind(this));
        this.style();
    }

    private isFS() {
        return document.fullscreenElement === document.body;
    }

    private style() {
        this.elem.style.backgroundColor = this.hover ? 'rgba(50, 50, 50, 0.8)' : 'rgba(0, 0, 0, 0.8)';
        this.elem.textContent = this.isFS() ? '🡼' : '🡾';
    }

    private onClick() {
        if (this.isFS())
            document.exitFullscreen();
        else
            document.body.requestFullscreen();
    }
}

class Main {
    private toplevel: HTMLElement;
    private sceneUIContainer: HTMLElement;
    private canvas: HTMLCanvasElement;
    private fsButton: FsButton;

    constructor() {
        this.init();
    }

    public async init() {
        this.canvas = document.createElement('canvas');

        // Initialize viewer

        this.toplevel = document.createElement('div');
        document.body.appendChild(this.toplevel);

        this.toplevel.appendChild(this.canvas);
        window.onresize = this.onResize.bind(this);

        this.fsButton = new FsButton();
        this.toplevel.appendChild(this.fsButton.elem);

        this.sceneUIContainer = document.createElement('div');
        this.sceneUIContainer.style.pointerEvents = 'none';
        this.sceneUIContainer.style.position = 'absolute';
        this.sceneUIContainer.style.top = '0';
        this.sceneUIContainer.style.left = '0';
        this.toplevel.appendChild(this.sceneUIContainer);

        this.onResize();

        this._updateLoop(0);
    }

    private _updateLoop = (time: number) => {
        window.requestAnimationFrame(this._updateLoop);
    };

    private onResize() {
        const devicePixelRatio = window.devicePixelRatio || 1;
        this.canvas.width = Math.ceil(window.innerWidth * devicePixelRatio);
        this.canvas.height = Math.ceil(window.innerHeight * devicePixelRatio);
    }
}

window.main = new Main();
