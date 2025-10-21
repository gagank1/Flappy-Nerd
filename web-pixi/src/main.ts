import {
  Application,
  Container,
  Graphics,
  Renderer,
  Sprite,
  Text,
  Texture,
  TilingSprite,
} from 'pixi.js';

const LOGICAL_WIDTH = 1200;
const LOGICAL_HEIGHT = 800;

const FRAME_DURATION = 12 / 1000; // Original Swing timer tick (12 ms)

const GRAVITY = 0.9 / FRAME_DURATION;
const FLAP_VELOCITY = -15 / FRAME_DURATION;
const PIPE_SPEED = 7 / FRAME_DURATION;
const PIPE_SPACING = 700;
const PIPE_WIDTH = 100;
const PIPE_TOP_Y = -500;
const PIPE_TOP_HEIGHT = 635;
const PIPE_BOTTOM_Y = 595;
const PIPE_BOTTOM_HEIGHT = 1000;
const PIPE_SHIFT_RANGE = 50;
const FIRST_PIPE_X = 1500;

const BIRD_WIDTH = 40;
const BIRD_HEIGHT = 30;
const BIRD_X = 80;
const BIRD_START_Y = 300;
const BIRD_DEATH_Y = 685;

const HOME_BIRD_SPEED = 10 / FRAME_DURATION;
const HOME_BIRD_VERTICAL_SPEED = 6 / FRAME_DURATION;
const TREE_COUNT = 20;

const MAX_FRAME_DELTA = 0.1;
const FIXED_STEP = FRAME_DURATION;

const searchParams = new URLSearchParams(window.location.search);
const debugEnabled = searchParams.get('debug') === '1';
const uncappedRender = searchParams.get('fps') === 'uncapped';

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

function createTexture(renderer: Renderer, draw: (graphics: Graphics) => void): Texture {
  const graphics = new Graphics();
  draw(graphics);
  const texture = renderer.generateTexture(graphics);
  graphics.destroy();
  return texture;
}

function createCloudTexture(renderer: Renderer): Texture {
  return createTexture(renderer, (g) => {
    g.lineStyle({ width: 4, color: 0x000000, alignment: 0.5 });
    g.beginFill(0xffffff);
    g.drawEllipse(45, 38, 45, 30);
    g.drawEllipse(105, 28, 55, 35);
    g.drawEllipse(165, 40, 50, 28);
    g.drawEllipse(210, 34, 40, 24);
    g.endFill();
  });
}

function createGroundTexture(renderer: Renderer): Texture {
  return createTexture(renderer, (g) => {
    const width = 240;
    const topHeight = 21;
    const baseHeight = 120;

    g.lineStyle({ width: 4, color: 0x000000 });
    g.beginFill(0x05be05);
    g.drawRect(0, 0, width, topHeight);
    g.endFill();

    g.lineStyle({ width: 2, color: 0x329600 });
    for (let i = -20; i < width + 60; i += 80) {
      g.moveTo(i + 2, topHeight + baseHeight);
      g.lineTo(i - 18, topHeight);
    }

    g.lineStyle({ width: 4, color: 0x000000 });
    g.beginFill(0x653300);
    g.drawRect(0, topHeight, width, baseHeight);
    g.endFill();
  });
}

class Bird extends Container {
  private readonly body: Graphics;
  private readonly wing: Graphics;
  private readonly eye: Graphics;
  private readonly beak: Graphics;

  constructor() {
    super();

    this.body = new Graphics();
    this.body.lineStyle({ width: 4, color: 0x000000, alignment: 0.5 });
    this.body.beginFill(0xff2d2d);
    this.body.drawRoundedRect(-BIRD_WIDTH / 2, -BIRD_HEIGHT / 2, BIRD_WIDTH, BIRD_HEIGHT, 16);
    this.body.endFill();

    this.wing = new Graphics();
    this.drawWing(false);

    this.eye = new Graphics();
    this.eye.beginFill(0x000000);
    this.eye.drawCircle(BIRD_WIDTH / 2 - 8, -BIRD_HEIGHT / 2 + 5, 2);
    this.eye.endFill();

    this.beak = new Graphics();
    this.drawBeak();

    this.addChild(this.body, this.wing, this.eye, this.beak);
  }

  private drawBeak(): void {
    this.beak.clear();
    this.beak.lineStyle({ width: 3, color: 0x000000 });
    this.beak.beginFill(0xffd93b);
    this.beak.moveTo(BIRD_WIDTH / 2, -6);
    this.beak.lineTo(BIRD_WIDTH / 2 + 15, 0);
    this.beak.lineTo(BIRD_WIDTH / 2, 6);
    this.beak.closePath();
    this.beak.endFill();
  }

  private drawWing(descending: boolean): void {
    const topY = descending ? -10 : 10;
    const bottomY = descending ? 2 : -2;
    this.wing.clear();
    this.wing.lineStyle({ width: 3, color: 0x000000 });
    this.wing.beginFill(0xff5555, 0.4);
    this.wing.moveTo(-10, bottomY);
    this.wing.lineTo(0, topY);
    this.wing.lineTo(10, bottomY);
    this.wing.closePath();
    this.wing.endFill();
  }

  public setWing(descending: boolean): void {
    this.drawWing(descending);
  }
}

class PipePair {
  public readonly container: Container = new Container();
  private readonly top: Graphics = new Graphics();
  private readonly bottom: Graphics = new Graphics();
  public shift = 0;
  private baseX = 0;

  constructor() {
    this.container.addChild(this.top, this.bottom);
    this.drawPipeGraphics(this.top, PIPE_TOP_HEIGHT);
    this.drawPipeGraphics(this.bottom, PIPE_BOTTOM_HEIGHT);
    this.applyShift(0);
  }

  private drawPipeGraphics(graphics: Graphics, height: number): void {
    graphics.clear();
    graphics.lineStyle({ width: 4, color: 0x000000 });
    graphics.beginFill(0x00a900);
    graphics.drawRect(0, 0, PIPE_WIDTH, height);
    graphics.endFill();

    graphics.lineStyle({ width: 4, color: 0x000000 });
    graphics.beginFill(0x00c000);
    graphics.drawRoundedRect(-5, 0, PIPE_WIDTH + 10, 20, 8);
    graphics.endFill();

    graphics.lineStyle({ width: 4, color: 0x000000 });
    graphics.beginFill(0x00c000);
    graphics.drawRoundedRect(-5, height - 20, PIPE_WIDTH + 10, 20, 8);
    graphics.endFill();
    graphics.cacheAsBitmap = true;
  }

  public setX(x: number): void {
    this.baseX = x;
    this.container.x = x;
  }

  public applyShift(shift: number): void {
    this.shift = shift;
    this.top.y = PIPE_TOP_Y + shift;
    this.bottom.y = PIPE_BOTTOM_Y + shift;
  }

  public getTopBounds(): RectBounds {
    return {
      x: this.baseX,
      y: this.top.y,
      width: PIPE_WIDTH,
      height: PIPE_TOP_HEIGHT,
    };
  }

  public getBottomBounds(): RectBounds {
    return {
      x: this.baseX,
      y: this.bottom.y,
      width: PIPE_WIDTH,
      height: PIPE_BOTTOM_HEIGHT,
    };
  }

  public getWorldX(): number {
    return this.baseX;
  }
}

interface TreeInstance {
  baseX: number;
  initialBase: number;
  sprite: Container;
  height: number;
}

class Game {
  private readonly world: Container;
  private readonly playfield: Container = new Container();
  private readonly pipeContainer: Container = new Container();
  private readonly pipes: PipePair[] = [];
  private readonly bird: Bird = new Bird();
  private readonly idleBirds: Container = new Container();
  private readonly homeBird: Bird = new Bird();
  private readonly homeBirdGhost: Bird = new Bird();
  private readonly scoreText: Text = new Text('0', {
    fontFamily: 'Arial Black, sans-serif',
    fontSize: 96,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 10,
    align: 'center',
  });
  private readonly fpsText: Text = new Text('FPS: 0', {
    fontFamily: 'Arial Black, sans-serif',
    fontSize: 32,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 6,
  });
  private readonly titleText: Text = new Text('Flappy Nerd', {
    fontFamily: 'Arial Black, sans-serif',
    fontSize: 120,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 14,
    align: 'center',
  });
  private readonly debugGraphics: Graphics = new Graphics();
  private readonly cloudLayer: TilingSprite;
  private readonly distantGround: { layer: TilingSprite; shift: number }[] = [];
  private readonly frontGround: TilingSprite;
  private readonly treeContainer: Container = new Container();
  private readonly trees: TreeInstance[] = [];

  private birdWorldX = BIRD_X;
  private birdY = BIRD_START_Y;
  private birdVelocity = 0;
  private started = false;
  private alive = true;
  private score = 0;
  private framesPassed = 0;
  private scrollDistance = 0;
  private accumulatedFrames = 0;
  private fpsTimer = 0;

  private homeBirdX = 0;
  private homeBirdY = BIRD_START_Y;
  private homeBirdVelocity = -HOME_BIRD_VERTICAL_SPEED;

  constructor(world: Container, renderer: Renderer) {
    this.world = world;

    this.world.addChild(this.playfield);
    this.playfield.sortableChildren = true;

    const background = new Sprite(Texture.WHITE);
    background.tint = 0x5efeee;
    background.width = LOGICAL_WIDTH;
    background.height = LOGICAL_HEIGHT;
    background.position.set(0, 0);
    this.playfield.addChild(background);

    this.cloudLayer = new TilingSprite(createCloudTexture(renderer), LOGICAL_WIDTH + 400, 90);
    this.cloudLayer.position.set(-200, -40);
    this.playfield.addChild(this.cloudLayer);

    const groundTexture = createGroundTexture(renderer);

    this.createGroundLayers(groundTexture);
    this.playfield.addChild(this.treeContainer);
    this.createTrees();

    this.pipeContainer.sortableChildren = false;
    this.playfield.addChild(this.pipeContainer);

    this.bird.position.set(BIRD_X, this.birdY);
    this.bird.visible = false;
    this.playfield.addChild(this.bird);

    this.frontGround = new TilingSprite(groundTexture, LOGICAL_WIDTH + 400, groundTexture.height);
    this.frontGround.y = 730;
    this.frontGround.x = -200;
    this.frontGround.alpha = 0.95;
    this.playfield.addChild(this.frontGround);

    this.idleBirds.addChild(this.homeBird, this.homeBirdGhost);
    this.playfield.addChild(this.idleBirds);

    this.scoreText.anchor.set(0.5, 0.5);
    this.scoreText.position.set(LOGICAL_WIDTH / 2, 100);
    this.world.addChild(this.scoreText);

    this.fpsText.anchor.set(1, 0);
    this.fpsText.position.set(LOGICAL_WIDTH - 12, 16);
    this.world.addChild(this.fpsText);

    this.titleText.anchor.set(0.5, 0.5);
    this.titleText.position.set(LOGICAL_WIDTH / 2, 150);
    this.world.addChild(this.titleText);

    if (debugEnabled) {
      this.debugGraphics.zIndex = 5000;
      this.playfield.addChild(this.debugGraphics);
    }

    this.createPipes();
    this.reset();
  }

  private createGroundLayers(texture: Texture): void {
    const layerConfig = [
      { shift: 0.4, offsetY: 30, alpha: 0.7 },
      { shift: 0.3, offsetY: 20, alpha: 0.8 },
      { shift: 0.2, offsetY: 10, alpha: 0.9 },
    ];

    for (const config of layerConfig) {
      const layer = new TilingSprite(texture, LOGICAL_WIDTH + 800, texture.height);
      layer.x = -200;
      layer.y = 720 - config.offsetY;
      layer.alpha = config.alpha;
      this.distantGround.push({ layer, shift: config.shift });
      this.playfield.addChild(layer);
    }
  }

  private createTrees(): void {
    for (let i = 0; i < TREE_COUNT; i += 1) {
      const tree = this.buildTree();
      const baseX = FIRST_PIPE_X + i * PIPE_SPACING;
      tree.sprite.x = baseX;
      tree.sprite.y = tree.height;
      this.treeContainer.addChild(tree.sprite);
      this.trees.push({ baseX, initialBase: baseX, sprite: tree.sprite, height: tree.height });
    }
  }

  private buildTree(): { sprite: Container; height: number } {
    const height = 300 + Math.random() * 300;
    const container = new Container();

    const trunk = new Graphics();
    trunk.lineStyle({ width: 4, color: 0x000000 });
    trunk.beginFill(0x653300);
    trunk.drawRect(20, 10, 30, 700);
    trunk.endFill();
    container.addChild(trunk);

    const outlineColor = 0x000000;
    const leafColor = 0x00a000;
    const circles = [
      { x: 0, y: 0 },
      { x: 0, y: 25 },
      { x: 20, y: 15 },
      { x: -20, y: 15 },
      { x: -30, y: 25 },
      { x: 30, y: 25 },
    ];
    for (const circle of circles) {
      const leaf = new Graphics();
      leaf.lineStyle({ width: 3, color: outlineColor });
      leaf.beginFill(leafColor);
      leaf.drawEllipse(circle.x, circle.y, 35, 35);
      leaf.endFill();
      container.addChild(leaf);
    }

    container.cacheAsBitmap = true;
    return { sprite: container, height };
  }

  private createPipes(): void {
    const pipeCount = 6;
    for (let i = 0; i < pipeCount; i += 1) {
      const pipe = new PipePair();
      this.pipeContainer.addChild(pipe.container);
      this.pipes.push(pipe);
    }
  }
  private resetPipes(): void {
    let x = FIRST_PIPE_X;
    for (const pipe of this.pipes) {
      const shift = Math.round(Math.random() * PIPE_SHIFT_RANGE * 2) - PIPE_SHIFT_RANGE;
      pipe.applyShift(shift);
      pipe.setX(x);
      // reset pipe state
      x += PIPE_SPACING;
    }
  }

  public reset(): void {
    this.birdWorldX = BIRD_X;
    this.birdY = BIRD_START_Y;
    this.birdVelocity = 0;
    this.started = false;
    this.alive = true;
    this.score = 0;
    this.framesPassed = 0;
    this.scrollDistance = 0;
    this.scoreText.text = '0';
    this.bird.visible = false;
    this.idleBirds.visible = true;
    this.titleText.visible = true;
    this.homeBirdX = 0;
    this.homeBirdY = BIRD_START_Y;
    this.homeBirdVelocity = -HOME_BIRD_VERTICAL_SPEED;
    for (const tree of this.trees) {
      tree.baseX = tree.initialBase;
      tree.height = 300 + Math.random() * 300;
      tree.sprite.y = tree.height;
      tree.sprite.x = tree.baseX;
    }
    this.homeBird.position.set(this.homeBirdX, this.homeBirdY);
    this.homeBirdGhost.position.set(this.homeBirdX - LOGICAL_WIDTH, this.homeBirdY);
    this.resetPipes();
    this.syncSprites();
    this.updateParallax();
  }

  public flap(): void {
    if (!this.started) {
      this.started = true;
      this.bird.visible = true;
      this.idleBirds.visible = false;
    }

    if (!this.alive) {
      this.reset();
      this.started = true;
      this.bird.visible = true;
      this.idleBirds.visible = false;
    }

    if (this.birdY > 50) {
      this.birdVelocity = FLAP_VELOCITY;
    }
  }

  public updateFixed(dt: number): void {
    if (!this.started) {
      this.updateIdleBirds(dt);
      this.updateParallax();
      return;
    }

    this.birdVelocity += GRAVITY * dt;
    this.birdY += this.birdVelocity * dt;

    if (this.alive) {
      this.framesPassed += 1;
      this.birdWorldX += PIPE_SPEED * dt;
    }

    if (this.birdY > BIRD_DEATH_Y && this.alive) {
      this.kill();
    }

    this.scrollDistance = this.birdWorldX - BIRD_X;

    if (this.alive) {
      this.recyclePipes();
      this.checkCollisions();
      this.updateScore();
    } else if (this.birdY > BIRD_DEATH_Y) {
      this.birdY = BIRD_DEATH_Y;
      this.birdVelocity = 0;
    }

    this.updateParallax();
  }

  private updateIdleBirds(dt: number): void {
    this.homeBirdX += HOME_BIRD_SPEED * dt;
    if (this.homeBirdX > LOGICAL_WIDTH) {
      this.homeBirdX -= LOGICAL_WIDTH;
    }

    this.homeBirdY += this.homeBirdVelocity * dt;
    if (this.homeBirdY < 260) {
      this.homeBirdY = 260;
      this.homeBirdVelocity = HOME_BIRD_VERTICAL_SPEED;
    } else if (this.homeBirdY > 360) {
      this.homeBirdY = 360;
      this.homeBirdVelocity = -HOME_BIRD_VERTICAL_SPEED;
    }

    this.homeBird.position.set(this.homeBirdX, this.homeBirdY);
    this.homeBirdGhost.position.set(this.homeBirdX - LOGICAL_WIDTH, this.homeBirdY);

    const descending = this.homeBirdVelocity > 0;
    this.homeBird.rotation = 0;
    this.homeBird.setWing(descending);
    this.homeBirdGhost.rotation = 0;
    this.homeBirdGhost.setWing(descending);
  }

  private recyclePipes(): void {
    const first = this.pipes[0];
    const screenRight = first.getWorldX() - this.scrollDistance + PIPE_WIDTH;
    if (screenRight < -300) {
      const last = this.pipes[this.pipes.length - 1];
      const shift = Math.round(Math.random() * PIPE_SHIFT_RANGE * 2) - PIPE_SHIFT_RANGE;
      first.applyShift(shift);
      first.setX(last.getWorldX() + PIPE_SPACING);
      this.pipes.push(this.pipes.shift()!);
    }
  }

  private updateScore(): void {
    const computed = Math.max(
      0,
      Math.floor((this.birdWorldX - FIRST_PIPE_X + PIPE_SPACING) / PIPE_SPACING),
    );
    if (computed !== this.score) {
      this.score = computed;
      this.scoreText.text = `${this.score}`;
    }
  }

  private checkCollisions(): void {
    if (!this.alive) {
      return;
    }

    const birdBounds: RectBounds = {
      x: this.birdWorldX - BIRD_WIDTH / 2,
      y: this.birdY - BIRD_HEIGHT / 2,
      width: BIRD_WIDTH,
      height: BIRD_HEIGHT,
    };

    for (const pipe of this.pipes) {
      if (
        intersects(birdBounds, pipe.getTopBounds()) ||
        intersects(birdBounds, pipe.getBottomBounds())
      ) {
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
    this.playfield.x = -this.scrollDistance;

    this.bird.position.set(this.birdWorldX, this.birdY);
    const velocityPerTick = this.birdVelocity * FRAME_DURATION;
    this.bird.rotation = Math.max(-0.6, Math.min(0.6, velocityPerTick * 0.03));
    this.bird.setWing(velocityPerTick > 0);

    this.scoreText.visible = this.started;

    this.titleText.y = 150 - this.framesPassed * 25;
    if (this.titleText.y < -200) {
      this.titleText.visible = false;
    }

    if (debugEnabled) {
      this.debugGraphics.clear();
      this.debugGraphics.lineStyle({ width: 2, color: 0xff0000, alpha: 0.8 });
      this.debugGraphics.drawRect(
        this.birdWorldX - BIRD_WIDTH / 2,
        this.birdY - BIRD_HEIGHT / 2,
        BIRD_WIDTH,
        BIRD_HEIGHT,
      );
      this.debugGraphics.lineStyle({ width: 2, color: 0x0000ff, alpha: 0.7 });
      for (const pipe of this.pipes) {
        const top = pipe.getTopBounds();
        const bottom = pipe.getBottomBounds();
        this.debugGraphics.drawRect(top.x, top.y, top.width, top.height);
        this.debugGraphics.drawRect(bottom.x, bottom.y, bottom.width, bottom.height);
      }
    }
  }

  private updateParallax(): void {
    this.cloudLayer.x = -200 + this.scrollDistance * 0.9;

    for (const layer of this.distantGround) {
      layer.layer.x = -200 + this.scrollDistance * layer.shift;
    }

    this.frontGround.x = -200 - this.scrollDistance * 0.1;

    const loopDistance = PIPE_SPACING * TREE_COUNT;
    for (const tree of this.trees) {
      let worldX = tree.baseX + this.scrollDistance * 0.2;
      let screenX = worldX - this.scrollDistance;
      while (screenX < -250) {
        tree.baseX += loopDistance;
        tree.height = 300 + Math.random() * 300;
        tree.sprite.y = tree.height;
        worldX = tree.baseX + this.scrollDistance * 0.2;
        screenX = worldX - this.scrollDistance;
      }
      tree.sprite.x = worldX;
    }
  }

  public updateFpsCounter(realDt: number): void {
    this.accumulatedFrames += 1;
    this.fpsTimer += realDt;
    if (this.fpsTimer >= 1) {
      const fps = Math.round(this.accumulatedFrames / this.fpsTimer);
      this.fpsText.text = `FPS: ${fps}`;
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

  const game = new Game(world, app.renderer);
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
