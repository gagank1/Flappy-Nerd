import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';

const LOGICAL_WIDTH = 480;
const LOGICAL_HEIGHT = 800;
const ORIGINAL_FRAME_DURATION = 0.016; // ~62.5 FPS in the original Java game

const GRAVITY = 0.9 / ORIGINAL_FRAME_DURATION;
const FLAP_VELOCITY = -15 / ORIGINAL_FRAME_DURATION;
const PIPE_SPEED = 7 / ORIGINAL_FRAME_DURATION;
const PIPE_SPACING = 700;
const PIPE_WIDTH = 100;
const PIPE_TOP_Y = -500;
const PIPE_TOP_HEIGHT = 635;
const PIPE_BOTTOM_Y = 595;
const PIPE_BOTTOM_HEIGHT = 1000;
const PIPE_SHIFT_RANGE = 50;
const BIRD_WIDTH = 40;
const BIRD_HEIGHT = 30;
const BIRD_X = 80;
const GROUND_Y = 700;
const FLOOR_HEIGHT = LOGICAL_HEIGHT - GROUND_Y;

const MAX_FRAME_DELTA = 0.25;
const FIXED_STEP = 1 / 120;

const searchParams = new URLSearchParams(window.location.search);
const debugEnabled = searchParams.get('debug') === '1';
const uncappedRender = searchParams.get('fps') === 'uncapped';

function createRectSprite(width: number, height: number, tint: number): Sprite {
  const sprite = new Sprite(Texture.WHITE);
  sprite.width = width;
  sprite.height = height;
  sprite.tint = tint;
  return sprite;
}

interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: RectBounds, b: RectBounds): boolean {
  return !(
    a.x + a.width <= b.x ||
    a.x >= b.x + b.width ||
    a.y + a.height <= b.y ||
    a.y >= b.y + b.height
  );
}

class PipePair {
  public readonly container: Container = new Container();
  private readonly top: Sprite = createRectSprite(PIPE_WIDTH, PIPE_TOP_HEIGHT, 0x2ecc71);
  private readonly bottom: Sprite = createRectSprite(PIPE_WIDTH, PIPE_BOTTOM_HEIGHT, 0x27ae60);
  public x = 0;
  public shift = 0;
  public passed = false;

  constructor() {
    this.top.x = 0;
    this.bottom.x = 0;
    this.container.addChild(this.top, this.bottom);
    this.applyShift(0);
  }

  public setX(x: number): void {
    this.x = x;
    this.container.x = x;
  }

  public applyShift(shift: number): void {
    this.shift = shift;
    this.top.y = PIPE_TOP_Y + shift;
    this.bottom.y = PIPE_BOTTOM_Y + shift;
  }

  public getTopBounds(): RectBounds {
    return {
      x: this.x,
      y: this.top.y,
      width: PIPE_WIDTH,
      height: PIPE_TOP_HEIGHT,
    };
  }

  public getBottomBounds(): RectBounds {
    return {
      x: this.x,
      y: this.bottom.y,
      width: PIPE_WIDTH,
      height: PIPE_BOTTOM_HEIGHT,
    };
  }
}

class Game {
  private readonly world: Container;
  private readonly pipeContainer: Container = new Container();
  private readonly pipes: PipePair[] = [];
  private readonly birdSprite: Sprite = createRectSprite(BIRD_WIDTH, BIRD_HEIGHT, 0xe74c3c);
  private readonly floorSprite: Sprite = createRectSprite(LOGICAL_WIDTH, FLOOR_HEIGHT, 0x8b4513);
  private readonly backgroundSprite: Sprite = createRectSprite(LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x5ed8ff);
  private readonly scoreText: Text = new Text('0', {
    fontFamily: 'Fira Sans, Arial, sans-serif',
    fontSize: 72,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 6,
    fontWeight: '900',
    align: 'center',
  });
  private readonly fpsText: Text = new Text('FPS: 0', {
    fontFamily: 'Fira Sans, Arial, sans-serif',
    fontSize: 20,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 4,
  });
  private readonly debugGraphics: Graphics = new Graphics();

  private birdY = 300;
  private birdVelocity = 0;
  private alive = true;
  private started = false;
  private score = 0;
  private accumulatedFrames = 0;
  private fpsTimer = 0;
  private lastMeasuredFps = 0;

  constructor(world: Container) {
    this.world = world;
    this.backgroundSprite.position.set(0, 0);
    this.world.addChild(this.backgroundSprite);

    this.pipeContainer.sortableChildren = false;
    this.world.addChild(this.pipeContainer);

    this.floorSprite.position.set(0, GROUND_Y);
    this.world.addChild(this.floorSprite);

    this.birdSprite.anchor.set(0.5);
    this.birdSprite.position.set(BIRD_X, this.birdY);
    this.world.addChild(this.birdSprite);

    this.scoreText.anchor.set(0.5, 0);
    this.scoreText.position.set(LOGICAL_WIDTH / 2, 40);
    this.world.addChild(this.scoreText);

    this.fpsText.anchor.set(0, 0);
    this.fpsText.position.set(12, 12);
    this.world.addChild(this.fpsText);

    if (debugEnabled) {
      this.debugGraphics.zIndex = 1000;
      this.world.addChild(this.debugGraphics);
    }

    this.createPipes();
    this.reset();
  }

  private createPipes(): void {
    const pipeCount = 5;
    for (let i = 0; i < pipeCount; i += 1) {
      const pipe = new PipePair();
      this.pipeContainer.addChild(pipe.container);
      this.pipes.push(pipe);
    }
  }

  private resetPipes(): void {
    let x = LOGICAL_WIDTH + 200;
    for (const pipe of this.pipes) {
      const shift = Math.round(Math.random() * (PIPE_SHIFT_RANGE * 2)) - PIPE_SHIFT_RANGE;
      pipe.applyShift(shift);
      pipe.setX(x);
      pipe.passed = false;
      x += PIPE_SPACING;
    }
  }

  public reset(): void {
    this.birdY = 300;
    this.birdVelocity = 0;
    this.alive = true;
    this.started = false;
    this.score = 0;
    this.scoreText.text = '0';
    this.resetPipes();
    this.syncSprites();
  }

  public flap(): void {
    if (!this.started) {
      this.started = true;
    }
    if (!this.alive) {
      this.reset();
      this.started = true;
    }
    this.birdVelocity = FLAP_VELOCITY;
  }

  public updateFixed(dt: number): void {
    if (!this.started) {
      return;
    }

    this.birdVelocity += GRAVITY * dt;
    this.birdY += this.birdVelocity * dt;

    if (this.alive) {
      for (const pipe of this.pipes) {
        pipe.setX(pipe.x - PIPE_SPEED * dt);
      }
      this.recyclePipes();
      this.checkCollisions();
      this.updateScore();
    } else {
      if (this.birdY + BIRD_HEIGHT / 2 >= GROUND_Y) {
        this.birdY = GROUND_Y - BIRD_HEIGHT / 2;
        this.birdVelocity = 0;
      }
    }
  }

  private recyclePipes(): void {
    const first = this.pipes[0];
    if (first.x + PIPE_WIDTH < -300) {
      const last = this.pipes[this.pipes.length - 1];
      const shift = Math.round(Math.random() * (PIPE_SHIFT_RANGE * 2)) - PIPE_SHIFT_RANGE;
      first.applyShift(shift);
      first.setX(last.x + PIPE_SPACING);
      first.passed = false;
      this.pipes.push(this.pipes.shift()!);
    }
  }

  private updateScore(): void {
    for (const pipe of this.pipes) {
      if (!pipe.passed && pipe.x + PIPE_WIDTH < BIRD_X - BIRD_WIDTH / 2) {
        pipe.passed = true;
        this.score += 1;
        this.scoreText.text = `${this.score}`;
      }
    }
  }

  private checkCollisions(): void {
    const birdBounds: RectBounds = {
      x: BIRD_X - BIRD_WIDTH / 2,
      y: this.birdY - BIRD_HEIGHT / 2,
      width: BIRD_WIDTH,
      height: BIRD_HEIGHT,
    };

    if (birdBounds.y + birdBounds.height >= GROUND_Y) {
      this.kill();
      return;
    }

    if (birdBounds.y <= -400) {
      this.kill();
      return;
    }

    for (const pipe of this.pipes) {
      if (intersects(birdBounds, pipe.getTopBounds()) || intersects(birdBounds, pipe.getBottomBounds())) {
        this.kill();
        return;
      }
    }
  }

  private kill(): void {
    if (this.alive) {
      this.alive = false;
    }
  }

  public syncSprites(): void {
    this.birdSprite.position.set(BIRD_X, this.birdY);
    this.birdSprite.rotation = Math.max(-0.6, Math.min(0.6, (this.birdVelocity / FLAP_VELOCITY) * -0.3));

    if (debugEnabled) {
      this.debugGraphics.clear();
      this.debugGraphics.lineStyle({ color: 0xff0000, width: 2, alpha: 0.8 });
      this.debugGraphics.drawRect(BIRD_X - BIRD_WIDTH / 2, this.birdY - BIRD_HEIGHT / 2, BIRD_WIDTH, BIRD_HEIGHT);
      this.debugGraphics.lineStyle({ color: 0x0000ff, width: 2, alpha: 0.6 });
      for (const pipe of this.pipes) {
        const top = pipe.getTopBounds();
        const bottom = pipe.getBottomBounds();
        this.debugGraphics.drawRect(top.x, top.y, top.width, top.height);
        this.debugGraphics.drawRect(bottom.x, bottom.y, bottom.width, bottom.height);
      }
      this.debugGraphics.lineStyle({ color: 0x00ff00, width: 2, alpha: 0.6 });
      this.debugGraphics.drawRect(0, GROUND_Y, LOGICAL_WIDTH, FLOOR_HEIGHT);
    }
  }

  public updateFpsCounter(realDt: number): void {
    this.accumulatedFrames += 1;
    this.fpsTimer += realDt;
    if (this.fpsTimer >= 1) {
      this.lastMeasuredFps = Math.round(this.accumulatedFrames / this.fpsTimer);
      this.fpsText.text = `FPS: ${this.lastMeasuredFps}`;
      this.fpsTimer = 0;
      this.accumulatedFrames = 0;
    }
  }
}

class GameInput {
  constructor(private readonly onFlap: () => void) {}

  public initialize(canvas: HTMLCanvasElement, button: HTMLButtonElement): void {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
        this.onFlap();
      }
    });

    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.onFlap();
    });

    button.addEventListener('click', () => {
      this.onFlap();
    });

    canvas.addEventListener('touchstart', (event) => {
      event.preventDefault();
      this.onFlap();
    });
  }

  public flap(): void {
    this.onFlap();
  }
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const button = document.getElementById('flap-button') as HTMLButtonElement;
  const container = document.getElementById('game-container') as HTMLElement;

  const app = new Application();
  await app.init({
    view: canvas,
    preference: 'webgpu',
    backgroundAlpha: 1,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
    resizeTo: container,
  });
  app.ticker.stop();

  const world = new Container();
  world.sortableChildren = true;
  app.stage.addChild(world);

  const game = new Game(world);
  const gameInput = new GameInput(() => game.flap());
  gameInput.initialize(canvas, button);

  window.gameInput = gameInput;
  window.triggerJump = () => gameInput.flap();

  const resize = () => {
    const renderer = app.renderer;
    const viewWidth = renderer.canvas.width / renderer.resolution;
    const viewHeight = renderer.canvas.height / renderer.resolution;
    const scale = Math.min(viewWidth / LOGICAL_WIDTH, viewHeight / LOGICAL_HEIGHT);
    world.scale.set(scale);
    world.position.set(
      (viewWidth - LOGICAL_WIDTH * scale) / 2,
      (viewHeight - LOGICAL_HEIGHT * scale) / 2,
    );
  };

  resize();
  window.addEventListener('resize', resize);

  let lastTime = performance.now();
  let accumulator = 0;

  const scheduleFrame = (cb: FrameRequestCallback) => {
    if (uncappedRender) {
      return window.setTimeout(() => cb(performance.now()), 0);
    }
    return window.requestAnimationFrame(cb);
  };

  const loop: FrameRequestCallback = (now) => {
    const deltaSeconds = Math.min((now - lastTime) / 1000, MAX_FRAME_DELTA);
    lastTime = now;
    accumulator += deltaSeconds;

    while (accumulator >= FIXED_STEP) {
      game.updateFixed(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }

    game.syncSprites();
    game.updateFpsCounter(deltaSeconds);
    app.render();

    scheduleFrame(loop);
  };

  scheduleFrame(loop);
}

bootstrap();

declare global {
  interface Window {
    triggerJump: () => void;
    gameInput?: GameInput;
  }
}
