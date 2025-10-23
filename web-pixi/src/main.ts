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

const ORIGINAL_FRAME_DURATION = 12 / 1000; // Original Swing timer tick (12 ms)
const ORIGINAL_TICKS_PER_SECOND = 1 / ORIGINAL_FRAME_DURATION;

const GRAVITY_PER_TICK = 0.9;
const FLAP_IMPULSE = -15;
const PIPE_SPEED_PER_TICK = 7;
const PIPE_SPACING = 700;
const PIPE_WIDTH = 100;
const PIPE_TOP_Y = -500;
const PIPE_TOP_HEIGHT = 635;
const PIPE_BOTTOM_Y = 595;
const PIPE_BOTTOM_HEIGHT = 1000;
const PIPE_MIDDLE_Y = 315;
const PIPE_MIDDLE_HEIGHT = 100;
const PIPE_ANSWER_ZONE_HEIGHT = 180;
const PIPE_TOP_ANSWER_Y = 135;
const PIPE_BOTTOM_ANSWER_Y = 415;
const PIPE_SHIFT_RANGE = 50;
const FIRST_PIPE_X = 1500;

const CLOUD_BASE_Y = 40;
const CLOUD_SCROLL_FACTOR = 0.3;
const GROUND_BASE_X = -100;

const BIRD_WIDTH = 40;
const BIRD_HEIGHT = 30;
const BIRD_X = 80;
const BIRD_START_Y = 300;
const BIRD_DEATH_Y = 685;

const HOME_BIRD_SPEED_PER_TICK = 10;
const HOME_BIRD_VERTICAL_SPEED_PER_TICK = 6;
const TREE_COUNT = 20;

const MAX_FRAME_DELTA = 0.1;

const searchParams = new URLSearchParams(window.location.search);
const debugEnabled = searchParams.get('debug') === '1';
const uncappedRender = searchParams.get('fps') === 'uncapped';

interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PipeQuestion {
  prompt: string;
  correctAnswer: string;
  wrongAnswer: string;
  correctIsBottom: boolean;
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
    g.setStrokeStyle({ width: 4, color: 0x000000, alignment: 0.5 })
      .roundRect(0, 36, 240, 48, 24)
      .ellipse(45, 32, 45, 30)
      .ellipse(110, 24, 55, 34)
      .ellipse(170, 34, 50, 28)
      .ellipse(210, 30, 38, 24)
      .fill(0xffffff);
  });
}

function createGroundTexture(renderer: Renderer): Texture {
  return createTexture(renderer, (g) => {
    const width = 240;
    const grassHeight = 36;
    const dirtHeight = 120;
    const stripeWidth = 24;
    const stripeColors = [0x3fbf3f, 0x33a833, 0x46c146];

    // Ground base
    g.setStrokeStyle({ width: 4, color: 0x000000 })
      .rect(0, grassHeight, width, dirtHeight)
      .fill(0x7a401c);

    // Grass top
    g.setStrokeStyle({ width: 4, color: 0x000000 })
      .rect(0, 0, width, grassHeight)
      .fill(0x3ab049);

    // Grass color variation
    g.setStrokeStyle({ width: 0 });
    for (let x = 0; x < width; x += stripeWidth) {
      const color = stripeColors[(x / stripeWidth) % stripeColors.length];
      g.rect(x, 0, stripeWidth, grassHeight)
        .fill(color);
    }

    // Outline between grass and dirt
    g.setStrokeStyle({ width: 3, color: 0x000000, alignment: 0.5 });
    g.moveTo(0, grassHeight);
    g.lineTo(width, grassHeight);
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
    this.body.setStrokeStyle({ width: 4, color: 0x000000, alignment: 0.5 })
      .roundRect(-BIRD_WIDTH / 2, -BIRD_HEIGHT / 2, BIRD_WIDTH, BIRD_HEIGHT, 16)
      .fill(0xff2d2d);

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
    this.beak.setStrokeStyle({ width: 3, color: 0x000000 })
      .moveTo(BIRD_WIDTH / 2, -6)
      .lineTo(BIRD_WIDTH / 2 + 15, 0)
      .lineTo(BIRD_WIDTH / 2, 6)
      .closePath()
      .fill(0xffd93b);
  }

  private drawWing(descending: boolean): void {
    const topY = descending ? -10 : 10;
    const bottomY = descending ? 2 : -2;
    this.wing.clear();
    this.wing.setStrokeStyle({ width: 3, color: 0x000000 })
      .moveTo(-10, bottomY)
      .lineTo(0, topY)
      .lineTo(10, bottomY)
      .closePath()
      .fill(0xff5555, 0.4);
  }

  public setWing(descending: boolean): void {
    this.drawWing(descending);
  }
}

class PipePair {
  public readonly container: Container = new Container();
  private readonly top: Graphics = new Graphics();
  private readonly middle: Graphics = new Graphics();
  private readonly bottom: Graphics = new Graphics();
  private readonly answerTopText: Text;
  private readonly answerBottomText: Text;
  private readonly questionText: Text;
  public shift = 0;
  private baseX = 0;
  private correctIsBottom = true;
  private wrongBounds: RectBounds = { x: 0, y: 0, width: PIPE_WIDTH, height: PIPE_ANSWER_ZONE_HEIGHT };
  private rightBounds: RectBounds = { x: 0, y: 0, width: PIPE_WIDTH, height: PIPE_ANSWER_ZONE_HEIGHT };

  constructor() {
    const answerStyle = {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: 40,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 8,
      align: 'left' as const,
    };

    this.answerTopText = new Text('', answerStyle);
    this.answerBottomText = new Text('', answerStyle);
    this.answerTopText.anchor.set(0, 0.5);
    this.answerBottomText.anchor.set(0, 0.5);

    this.questionText = new Text('', {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: 40,
      fill: 0xffffff,
      stroke: {
        color: 0x000000,
        width: 8,
      },
      align: 'left',
    });
    this.questionText.anchor.set(0, 0.5);

    this.container.addChild(
      this.top,
      this.middle,
      this.bottom,
      this.answerTopText,
      this.answerBottomText,
      this.questionText,
    );
    this.drawPipeGraphics(this.top, PIPE_TOP_HEIGHT);
    this.drawPipeGraphics(this.middle, PIPE_MIDDLE_HEIGHT);
    this.drawPipeGraphics(this.bottom, PIPE_BOTTOM_HEIGHT);
    this.applyShift(0);
    this.updateAnswerLayout();
  }

  private drawPipeGraphics(graphics: Graphics, height: number): void {
    graphics.clear();
    graphics.setStrokeStyle({ width: 4, color: 0x000000 });
    graphics.rect(0, 0, PIPE_WIDTH, height)
      .fill(0x00a900);
    graphics.roundRect(-5, 0, PIPE_WIDTH + 10, 20, 8)
      .fill(0x00c000);
    graphics.roundRect(-5, height - 20, PIPE_WIDTH + 10, 20, 8)
      .fill(0x00c000);
    graphics.cacheAsTexture(true);
  }

  public setX(x: number): void {
    this.baseX = x;
    this.container.x = x;
    this.updateAnswerLayout();
  }

  public applyShift(shift: number): void {
    this.shift = shift;
    this.top.y = PIPE_TOP_Y + shift;
    this.middle.y = PIPE_MIDDLE_Y + shift;
    this.bottom.y = PIPE_BOTTOM_Y + shift;
    this.updateAnswerLayout();
  }

  public setQuestion(question: PipeQuestion): void {
    this.correctIsBottom = question.correctIsBottom;
    const topAnswer = this.correctIsBottom ? question.wrongAnswer : question.correctAnswer;
    const bottomAnswer = this.correctIsBottom ? question.correctAnswer : question.wrongAnswer;

    this.answerTopText.text = topAnswer;
    this.answerBottomText.text = bottomAnswer;
    this.questionText.text = question.prompt;
    this.updateAnswerLayout();
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

  public getMiddleBounds(): RectBounds {
    return {
      x: this.baseX,
      y: this.middle.y,
      width: PIPE_WIDTH,
      height: PIPE_MIDDLE_HEIGHT,
    };
  }

  public getWrongBounds(): RectBounds {
    return this.wrongBounds;
  }

  public getRightBounds(): RectBounds {
    return this.rightBounds;
  }

  public getWorldX(): number {
    return this.baseX;
  }

  private updateAnswerLayout(): void {
    const topZoneY = PIPE_TOP_ANSWER_Y + this.shift;
    const bottomZoneY = PIPE_BOTTOM_ANSWER_Y + this.shift;
    const topCenterY = topZoneY + PIPE_ANSWER_ZONE_HEIGHT / 2;
    const bottomCenterY = bottomZoneY + PIPE_ANSWER_ZONE_HEIGHT / 2;

    const answerOffsetX = 4;
    this.answerTopText.position.set(answerOffsetX, topCenterY);
    this.answerBottomText.position.set(answerOffsetX, bottomCenterY);
    this.questionText.position.set(answerOffsetX, 690);

    const topBounds: RectBounds = {
      x: this.baseX,
      y: topZoneY,
      width: PIPE_WIDTH,
      height: PIPE_ANSWER_ZONE_HEIGHT,
    };
    const bottomBounds: RectBounds = {
      x: this.baseX,
      y: bottomZoneY,
      width: PIPE_WIDTH,
      height: PIPE_ANSWER_ZONE_HEIGHT,
    };

    if (this.correctIsBottom) {
      this.rightBounds = bottomBounds;
      this.wrongBounds = topBounds;
    } else {
      this.rightBounds = topBounds;
      this.wrongBounds = bottomBounds;
    }
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
    stroke: {
      color: 0x000000,
      width: 10,
    },
    align: 'center',
  });
  private readonly fpsText: Text = new Text('FPS: 0', {
    fontFamily: 'Arial Black, sans-serif',
    fontSize: 32,
    fill: 0xffffff,
    stroke: {
      color: 0x000000,
      width: 6,
    },
  });
  private readonly titleText: Text = new Text('Flappy Nerd', {
    fontFamily: 'Arial Black, sans-serif',
    fontSize: 120,
    fill: 0xffffff,
    stroke: {
      color: 0x000000,
      width: 14,
    },
    align: 'center',
  });
  private readonly background: Sprite;
  private readonly debugGraphics: Graphics = new Graphics();
  private readonly cloudLayer: TilingSprite;
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
  private homeBirdVelocity = -HOME_BIRD_VERTICAL_SPEED_PER_TICK;

  constructor(world: Container, renderer: Renderer) {
    this.world = world;

    this.world.addChild(this.playfield);
    this.playfield.sortableChildren = true;

    this.background = new Sprite(Texture.WHITE);
    this.background.tint = 0x5efeee;
    this.background.width = LOGICAL_WIDTH;
    this.background.height = LOGICAL_HEIGHT;
    this.background.position.set(0, 0);
    this.playfield.addChild(this.background);

    this.cloudLayer = new TilingSprite(createCloudTexture(renderer), LOGICAL_WIDTH + 400, 90);
    this.cloudLayer.position.set(0, CLOUD_BASE_Y);
    this.playfield.addChild(this.cloudLayer);

    const groundTexture = createGroundTexture(renderer);

    this.playfield.addChild(this.treeContainer);
    this.createTrees();

    this.pipeContainer.sortableChildren = false;
    this.playfield.addChild(this.pipeContainer);

    this.bird.position.set(BIRD_X, this.birdY);
    this.bird.visible = false;
    this.playfield.addChild(this.bird);

    this.frontGround = new TilingSprite(groundTexture, LOGICAL_WIDTH + 400, groundTexture.height);
    this.frontGround.y = 730;
    this.frontGround.x = GROUND_BASE_X;
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
    trunk.setStrokeStyle({ width: 4, color: 0x000000 });
    trunk.rect(-15, 10, 30, 700)
      .fill(0x653300);
    container.addChild(trunk);

    const outlineColor = 0x000000;
    const leafColor = 0x00a000;
    const circles = [
      { x: 0, y: 0 },
      { x: 0, y: 25 },
      { x: 28, y: 15 },
      { x: -28, y: 15 },
      { x: -38, y: 25 },
      { x: 38, y: 25 },
    ];
    for (const circle of circles) {
      const leaf = new Graphics();
      leaf.setStrokeStyle({ width: 3, color: outlineColor });
      leaf.ellipse(circle.x, circle.y, 35, 35)
        .fill(leafColor);
      container.addChild(leaf);
    }

    container.cacheAsTexture(true);
    return { sprite: container, height };
  }

  private createPipes(): void {
    const pipeCount = 6;
    for (let i = 0; i < pipeCount; i += 1) {
      const pipe = new PipePair();
      this.pipeContainer.addChild(pipe.container);
      pipe.setQuestion(this.generateQuestion());
      this.pipes.push(pipe);
    }
  }
  private resetPipes(): void {
    let x = FIRST_PIPE_X;
    for (const pipe of this.pipes) {
      const shift = Math.round(Math.random() * PIPE_SHIFT_RANGE * 2) - PIPE_SHIFT_RANGE;
      pipe.applyShift(shift);
      pipe.setX(x);
      pipe.setQuestion(this.generateQuestion());
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
    this.homeBirdVelocity = -HOME_BIRD_VERTICAL_SPEED_PER_TICK;
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
      this.birdVelocity = FLAP_IMPULSE;
    }
  }

  public update(dt: number): void {
    const step = dt * ORIGINAL_TICKS_PER_SECOND;

    if (!this.started) {
      this.updateIdleBirds(step);
      this.updateParallax();
      return;
    }

    this.birdVelocity += GRAVITY_PER_TICK * step;
    this.birdY += this.birdVelocity * step;

    if (this.alive) {
      this.framesPassed += step;
      this.birdWorldX += PIPE_SPEED_PER_TICK * step;
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

  private updateIdleBirds(step: number): void {
    this.homeBirdX += HOME_BIRD_SPEED_PER_TICK * step;
    if (this.homeBirdX > LOGICAL_WIDTH) {
      this.homeBirdX -= LOGICAL_WIDTH;
    }

    this.homeBirdY += this.homeBirdVelocity * step;
    if (this.homeBirdY < 260) {
      this.homeBirdY = 260;
      this.homeBirdVelocity = HOME_BIRD_VERTICAL_SPEED_PER_TICK;
    } else if (this.homeBirdY > 360) {
      this.homeBirdY = 360;
      this.homeBirdVelocity = -HOME_BIRD_VERTICAL_SPEED_PER_TICK;
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
      first.setQuestion(this.generateQuestion());
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
        intersects(birdBounds, pipe.getBottomBounds()) ||
        intersects(birdBounds, pipe.getMiddleBounds()) ||
        intersects(birdBounds, pipe.getWrongBounds())
      ) {
        this.kill();
        return;
      }
    }
  }

  private generateQuestion(): PipeQuestion {
    const num1 = Math.floor(Math.random() * 9) + 1;
    const num2 = Math.floor(Math.random() * 9) + 1;
    const correct = num1 + num2;
    let wrong = correct;
    while (wrong === correct || wrong < 2 || wrong > 18) {
      wrong = Math.floor(Math.random() * 17) + 2;
    }
    const correctIsBottom = Math.random() < 0.5;
    return {
      prompt: `${num1}+${num2}`,
      correctAnswer: `${correct}`,
      wrongAnswer: `${wrong}`,
      correctIsBottom,
    };
  }

  private kill(): void {
    if (this.alive) {
      this.alive = false;
    }
  }

  public syncSprites(): void {
    this.playfield.x = -this.scrollDistance;

    this.bird.position.set(this.birdWorldX, this.birdY);
    const velocityPerTick = this.birdVelocity;
    this.bird.rotation = Math.max(-0.6, Math.min(0.6, velocityPerTick * 0.03));
    this.bird.setWing(velocityPerTick > 0);

    this.scoreText.visible = this.started;

    this.titleText.y = 150 - this.framesPassed * 25;
    if (this.titleText.y < -200) {
      this.titleText.visible = false;
    }

    if (debugEnabled) {
      this.debugGraphics.clear();
      this.debugGraphics.setStrokeStyle({ width: 2, color: 0xff0000, alpha: 0.8 });
      this.debugGraphics.rect(
        this.birdWorldX - BIRD_WIDTH / 2,
        this.birdY - BIRD_HEIGHT / 2,
        BIRD_WIDTH,
        BIRD_HEIGHT,
      );
      for (const pipe of this.pipes) {
        const top = pipe.getTopBounds();
        const middle = pipe.getMiddleBounds();
        const bottom = pipe.getBottomBounds();
        const wrong = pipe.getWrongBounds();
        const right = pipe.getRightBounds();

        this.debugGraphics.setStrokeStyle({ width: 2, color: 0x0000ff, alpha: 0.7 });
        this.debugGraphics.rect(top.x, top.y, top.width, top.height);
        this.debugGraphics.rect(bottom.x, bottom.y, bottom.width, bottom.height);
        this.debugGraphics.rect(middle.x, middle.y, middle.width, middle.height);

        this.debugGraphics.setStrokeStyle({ width: 2, color: 0xff0000, alpha: 0.5 });
        this.debugGraphics.rect(wrong.x, wrong.y, wrong.width, wrong.height);

        this.debugGraphics.setStrokeStyle({ width: 2, color: 0x00ff00, alpha: 0.5 });
        this.debugGraphics.rect(right.x, right.y, right.width, right.height);
      }
    }
  }

  private updateParallax(): void {
    const scroll = this.scrollDistance;
    this.background.x = scroll;

    this.cloudLayer.x = scroll;
    this.cloudLayer.tilePosition.x = -scroll * CLOUD_SCROLL_FACTOR;

    this.frontGround.x = scroll + GROUND_BASE_X;
    this.frontGround.tilePosition.x = -scroll;

    const loopDistance = PIPE_SPACING * TREE_COUNT;
    for (const tree of this.trees) {
      let worldX = tree.baseX + scroll * 0.2;
      let screenX = worldX - scroll;
      while (screenX < -250) {
        tree.baseX += loopDistance;
        tree.height = 300 + Math.random() * 300;
        tree.sprite.y = tree.height;
        worldX = tree.baseX + scroll * 0.2;
        screenX = worldX - scroll;
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

  if (uncappedRender) {
    app.ticker.maxFPS = 0;
  }

  app.ticker.add((ticker) => {
    const rawDeltaSeconds = ticker.elapsedMS / 1000;
    const dt = Math.min(rawDeltaSeconds, MAX_FRAME_DELTA);
    game.update(dt);
    game.syncSprites();
    game.updateFpsCounter(rawDeltaSeconds);
  });
}

bootstrap();

declare global {
  interface Window {
    triggerJump: () => void;
    gameInput?: GameInput;
  }
}
