use rand::{rngs::SmallRng, Rng, SeedableRng};

const STEP: f32 = 1.0 / 120.0;
const GRAVITY: f32 = 2200.0;
const FLAP_VELOCITY: f32 = -750.0;
const PIPE_WIDTH: f32 = 140.0;
const PIPE_MIN_GAP: f32 = 220.0;
const PIPE_MAX_GAP: f32 = 320.0;
const SCROLL_SPEED: f32 = 300.0;
const READY_BOB_SPEED: f32 = 3.5;
const READY_BOB_HEIGHT: f32 = 12.0;

#[derive(Copy, Clone, Debug)]
pub struct InstanceData {
    pub pos: [f32; 2],
    pub size: [f32; 2],
    pub color: [f32; 4],
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum GameState {
    Ready,
    Running,
    Dead,
}

#[derive(Clone, Debug)]
struct Pipe {
    x: f32,
    gap_center: f32,
    gap_height: f32,
    scored: bool,
}

#[derive(Clone, Debug)]
pub struct Palette {
    pub background: [f32; 4],
    pub pipe: [f32; 4],
    pub pipe_dark: [f32; 4],
    pub ground: [f32; 4],
    pub ground_edge: [f32; 4],
    pub bird_body: [f32; 4],
    pub bird_beak: [f32; 4],
}

impl Default for Palette {
    fn default() -> Self {
        Self {
            background: srgb(0x87, 0xce, 0xeb),
            pipe: srgb(0x2e, 0xc4, 0x41),
            pipe_dark: srgb(0x1c, 0x8a, 0x2b),
            ground: srgb(0x4b, 0x26, 0x0b),
            ground_edge: srgb(0x75, 0x40, 0x19),
            bird_body: srgb(0xe6, 0x22, 0x2f),
            bird_beak: srgb(0xff, 0xd0, 0x2a),
        }
    }
}

fn srgb(r: u8, g: u8, b: u8) -> [f32; 4] {
    [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 1.0]
}

#[derive(Debug)]
pub struct Game {
    palette: Palette,
    state: GameState,
    rng: SmallRng,
    screen_size: [f32; 2],
    ground_height: f32,
    bird_pos: [f32; 2],
    bird_vel: f32,
    bob_time: f32,
    pipes: Vec<Pipe>,
    score: u32,
    best_score: u32,
}

impl Game {
    pub fn new(palette: Palette) -> Self {
        let mut game = Self {
            palette,
            state: GameState::Ready,
            rng: SmallRng::from_entropy(),
            screen_size: [1280.0, 720.0],
            ground_height: 120.0,
            bird_pos: [0.0, 0.0],
            bird_vel: 0.0,
            bob_time: 0.0,
            pipes: Vec::new(),
            score: 0,
            best_score: 0,
        };
        game.resize(1280.0, 720.0);
        game
    }

    pub fn resize(&mut self, width: f32, height: f32) {
        self.screen_size = [width.max(1.0), height.max(1.0)];
        self.ground_height = (self.screen_size[1] * 0.18).clamp(80.0, 200.0);
        if self.score > self.best_score {
            self.best_score = self.score;
        }
        self.reset_internal();
    }

    pub fn set_background(&mut self, color: [f32; 4]) {
        self.palette.background = color;
    }

    fn reset_internal(&mut self) {
        self.state = GameState::Ready;
        self.bird_pos = [self.bird_x(), self.screen_size[1] * 0.45];
        self.bird_vel = 0.0;
        self.bob_time = 0.0;
        self.pipes.clear();
        self.score = 0;
        let start_x = self.screen_size[0] + 120.0;
        for i in 0..4 {
            let x = start_x + i as f32 * self.pipe_spacing();
            self.pipes.push(self.spawn_pipe_at(x));
        }
    }

    pub fn reset(&mut self) {
        if self.score > self.best_score {
            self.best_score = self.score;
        }
        self.reset_internal();
    }

    pub fn step(&mut self, dt: f32, mut flap: bool) {
        if dt <= 0.0 {
            return;
        }
        match self.state {
            GameState::Ready => {
                self.bob_time += dt;
                if flap {
                    self.state = GameState::Running;
                    self.bird_vel = FLAP_VELOCITY;
                    flap = false;
                }
                self.apply_ready_bob();
            }
            GameState::Running => {
                if flap {
                    self.bird_vel = FLAP_VELOCITY;
                    flap = false;
                }
                self.integrate(dt);
                self.scroll_world(dt);
                self.check_collisions();
            }
            GameState::Dead => {
                if flap {
                    self.reset();
                    return;
                }
                self.bird_vel += GRAVITY * dt;
                self.bird_pos[1] += self.bird_vel * dt;
                let ground_y = self.ground_top();
                if self.bird_bottom() > ground_y {
                    self.bird_pos[1] = ground_y - BIRD_SIZE[1] * 0.5;
                    self.bird_vel = 0.0;
                }
            }
        }
    }

    fn apply_ready_bob(&mut self) {
        let base_y = self.screen_size[1] * 0.45;
        self.bird_pos[1] = base_y + (self.bob_time * READY_BOB_SPEED).sin() * READY_BOB_HEIGHT;
    }

    fn integrate(&mut self, dt: f32) {
        self.bird_vel += GRAVITY * dt;
        self.bird_pos[1] += self.bird_vel * dt;
    }

    fn scroll_world(&mut self, dt: f32) {
        let scroll = SCROLL_SPEED * dt;
        let width = self.screen_size[0];
        let spacing = self.pipe_spacing();
        for pipe in &mut self.pipes {
            pipe.x -= scroll;
        }
        if let Some(front) = self.pipes.first() {
            if front.x + PIPE_WIDTH < -width * 0.2 {
                self.pipes.remove(0);
            }
        }
        while self.pipes.last().map(|p| p.x).unwrap_or(0.0) < width + spacing {
            let x = self
                .pipes
                .last()
                .map(|p| p.x + spacing)
                .unwrap_or(width + spacing);
            self.pipes.push(self.spawn_pipe_at(x));
        }
        let bird_x = self.bird_x();
        for pipe in &mut self.pipes {
            if !pipe.scored && pipe.x + PIPE_WIDTH < bird_x {
                pipe.scored = true;
                self.score += 1;
            }
        }
    }

    fn check_collisions(&mut self) {
        let ground_y = self.ground_top();
        if self.bird_bottom() > ground_y {
            self.state = GameState::Dead;
            return;
        }
        let bird_rect = self.bird_rect();
        for pipe in &self.pipes {
            if bird_rect.max_x() < pipe.x || bird_rect.min_x() > pipe.x + PIPE_WIDTH {
                continue;
            }
            let gap_half = pipe.gap_height * 0.5;
            let gap_top = pipe.gap_center - gap_half;
            let gap_bottom = pipe.gap_center + gap_half;
            if bird_rect.min_y() < gap_top || bird_rect.max_y() > gap_bottom {
                self.state = GameState::Dead;
                return;
            }
        }
        if self.bird_pos[1] < BIRD_SIZE[1] * 0.5 {
            self.state = GameState::Dead;
        }
    }

    fn spawn_pipe_at(&mut self, x: f32) -> Pipe {
        let gap_height = self
            .rng
            .gen_range(PIPE_MIN_GAP..=PIPE_MAX_GAP)
            .clamp(PIPE_MIN_GAP, PIPE_MAX_GAP);
        let min_center = (gap_height * 0.5 + 40.0).max(BIRD_SIZE[1]);
        let max_center = (self.ground_top() - gap_height * 0.5 - 40.0).max(min_center + 10.0);
        let gap_center = self.rng.gen_range(min_center..=max_center);
        Pipe {
            x,
            gap_center,
            gap_height,
            scored: false,
        }
    }

    fn pipe_spacing(&self) -> f32 {
        (self.screen_size[0] * 0.45).clamp(260.0, 420.0)
    }

    fn ground_top(&self) -> f32 {
        self.screen_size[1] - self.ground_height
    }

    fn bird_x(&self) -> f32 {
        self.screen_size[0] * 0.28
    }

    fn bird_bottom(&self) -> f32 {
        self.bird_pos[1] + BIRD_SIZE[1] * 0.5
    }

    fn bird_rect(&self) -> Rect {
        Rect {
            min: [
                self.bird_pos[0] - BIRD_SIZE[0] * 0.5,
                self.bird_pos[1] - BIRD_SIZE[1] * 0.5,
            ],
            size: [BIRD_SIZE[0], BIRD_SIZE[1]],
        }
    }

    pub fn instances(&self) -> Vec<InstanceData> {
        let mut instances = Vec::with_capacity(2 + self.pipes.len() * 3);
        let background = InstanceData {
            pos: [0.0, 0.0],
            size: self.screen_size,
            color: self.palette.background,
        };
        instances.push(background);

        for pipe in &self.pipes {
            let gap_half = pipe.gap_height * 0.5;
            let gap_top = pipe.gap_center - gap_half;
            let gap_bottom = pipe.gap_center + gap_half;
            instances.push(InstanceData {
                pos: [pipe.x, 0.0],
                size: [PIPE_WIDTH, gap_top.max(0.0)],
                color: self.palette.pipe,
            });
            instances.push(InstanceData {
                pos: [pipe.x, gap_bottom],
                size: [PIPE_WIDTH, (self.ground_top() - gap_bottom).max(0.0)],
                color: self.palette.pipe_dark,
            });
        }

        let ground_top = self.ground_top();
        instances.push(InstanceData {
            pos: [0.0, ground_top],
            size: [self.screen_size[0], self.ground_height],
            color: self.palette.ground,
        });
        instances.push(InstanceData {
            pos: [0.0, ground_top - 6.0],
            size: [self.screen_size[0], 6.0],
            color: self.palette.ground_edge,
        });

        let bird_rect = self.bird_rect();
        instances.push(InstanceData {
            pos: bird_rect.min,
            size: bird_rect.size,
            color: self.palette.bird_body,
        });
        instances.push(InstanceData {
            pos: [
                bird_rect.min[0] + bird_rect.size[0] * 0.75,
                bird_rect.min[1] + bird_rect.size[1] * 0.35,
            ],
            size: [bird_rect.size[0] * 0.25, bird_rect.size[1] * 0.25],
            color: self.palette.bird_beak,
        });

        instances
    }

    pub fn score(&self) -> u32 {
        self.score
    }

    pub fn best_score(&self) -> u32 {
        self.best_score
    }

    pub fn status_text(&self) -> &'static str {
        match self.state {
            GameState::Ready => "Tap or press Space to start",
            GameState::Running => "",
            GameState::Dead => "Game over – tap to retry",
        }
    }
}

#[derive(Copy, Clone, Debug)]
struct Rect {
    min: [f32; 2],
    size: [f32; 2],
}

impl Rect {
    fn max_x(&self) -> f32 {
        self.min[0] + self.size[0]
    }
    fn min_x(&self) -> f32 {
        self.min[0]
    }
    fn max_y(&self) -> f32 {
        self.min[1] + self.size[1]
    }
    fn min_y(&self) -> f32 {
        self.min[1]
    }
}

const BIRD_SIZE: [f32; 2] = [64.0, 48.0];

pub const FIXED_STEP: f32 = STEP;
