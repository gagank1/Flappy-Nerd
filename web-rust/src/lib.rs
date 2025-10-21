use std::{cell::RefCell, rc::Rc};

use anyhow::{anyhow, Result};
use bytemuck::{Pod, Zeroable};
use js_sys::Function;
use log::error;
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen::closure::Closure;
use web_sys::{self, window, HtmlCanvasElement, HtmlDivElement};
use wgpu::util::DeviceExt;

const WORLD_WIDTH: f32 = 288.0;
const WORLD_HEIGHT: f32 = 512.0;
const PIPE_GAP: f32 = 120.0;
const PIPE_SPACING: f32 = 220.0;
const PIPE_SPEED: f32 = 120.0;
const PIPE_WIDTH: f32 = 52.0;
const BIRD_X: f32 = 72.0;
const GRAVITY: f32 = 900.0;
const FLAP_VELOCITY: f32 = -320.0;
const STEP: f32 = 1.0 / 120.0;
const MAX_FALL_SPEED: f32 = 500.0;
const MAX_RISE_SPEED: f32 = -480.0;
const PIPE_MIN_Y: f32 = 160.0;
const PIPE_MAX_Y: f32 = 360.0;
const GROUND_HEIGHT: f32 = 100.0;

#[wasm_bindgen(start)]
pub async fn start() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    console_log::init_with_level(log::Level::Info).ok();

    let window = window().ok_or_else(|| JsValue::from_str("No window"))?;
    let document = window
        .document()
        .ok_or_else(|| JsValue::from_str("No document"))?;

    let canvas = document
        .get_element_by_id("game-canvas")
        .ok_or_else(|| JsValue::from_str("Missing canvas"))?
        .dyn_into::<HtmlCanvasElement>()?;

    let hud = document
        .get_element_by_id("hud")
        .ok_or_else(|| JsValue::from_str("Missing HUD"))?
        .dyn_into::<HtmlDivElement>()?;

    let jump_flag = Rc::new(RefCell::new(false));
    install_trigger_jump(&window, &jump_flag)?;
    install_input_listeners(&window, &canvas, &jump_flag)?;

    match run(canvas, hud.clone(), jump_flag.clone()).await {
        Ok(()) => Ok(()),
        Err(err) => {
            error!("{:#}", err);
            hud.set_inner_text("WebGPU not available\nCheck browser support (Safari 17.4/iOS 17.4+)");
            Err(JsValue::from_str(&format!("{err:#}")))
        }
    }
}

fn install_trigger_jump(window: &web_sys::Window, jump_flag: &Rc<RefCell<bool>>) -> Result<(), JsValue> {
    let flag = jump_flag.clone();
    let closure = Closure::wrap(Box::new(move || {
        *flag.borrow_mut() = true;
    }) as Box<dyn Fn()>);

    let func: &Function = closure.as_ref().unchecked_ref();
    js_sys::Reflect::set(window, &JsValue::from_str("triggerJump"), func)?;
    closure.forget();
    Ok(())
}

fn install_input_listeners(
    window: &web_sys::Window,
    canvas: &HtmlCanvasElement,
    jump_flag: &Rc<RefCell<bool>>,
) -> Result<(), JsValue> {
    let flag_key = jump_flag.clone();
    let key_closure = Closure::wrap(Box::new(move |event: web_sys::KeyboardEvent| {
        if event.repeat() {
            return;
        }
        match event.code().as_str() {
            "Space" | "ArrowUp" => {
                event.prevent_default();
                *flag_key.borrow_mut() = true;
            }
            _ => {}
        }
    }) as Box<dyn FnMut(_)>);
    window.add_event_listener_with_callback("keydown", key_closure.as_ref().unchecked_ref())?;
    key_closure.forget();

    let flag_mouse = jump_flag.clone();
    let mouse_closure = Closure::wrap(Box::new(move |_: web_sys::MouseEvent| {
        *flag_mouse.borrow_mut() = true;
    }) as Box<dyn FnMut(_)>);
    canvas.add_event_listener_with_callback("mousedown", mouse_closure.as_ref().unchecked_ref())?;
    mouse_closure.forget();

    let flag_touch = jump_flag.clone();
    let touch_closure = Closure::wrap(Box::new(move |event: web_sys::TouchEvent| {
        event.prevent_default();
        *flag_touch.borrow_mut() = true;
    }) as Box<dyn FnMut(_)>);
    canvas.add_event_listener_with_callback("touchstart", touch_closure.as_ref().unchecked_ref())?;
    touch_closure.forget();

    Ok(())
}

async fn run(canvas: HtmlCanvasElement, hud: HtmlDivElement, jump_flag: Rc<RefCell<bool>>) -> Result<()> {
    let instance = wgpu::Instance::default();
    let surface = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))?;

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| anyhow!("WebGPU adapter not available"))?;

    let (device, queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
            },
            None,
        )
        .await
        .map_err(|e| anyhow!("Request device failed: {}", e))?;

    let (width, height) = canvas_size(&canvas);
    let surface_caps = surface.get_capabilities(&adapter);
    let mut present_mode = wgpu::PresentMode::Fifo;
    if let Some(window) = web_sys::window() {
        if let Ok(query) = window.location().search() {
            if query.contains("uncapped=1")
                && surface_caps
                    .present_modes
                    .contains(&wgpu::PresentMode::Immediate)
            {
                present_mode = wgpu::PresentMode::Immediate;
            }
        }
    }
    let surface_format = surface_caps
        .formats
        .iter()
        .find(|format| format.is_srgb())
        .copied()
        .unwrap_or(surface_caps.formats[0]);

    let mut config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format: surface_format,
        width: width.max(1),
        height: height.max(1),
        present_mode,
        desired_maximum_frame_latency: 1,
        alpha_mode: wgpu::CompositeAlphaMode::Opaque,
        view_formats: vec![],
    };
    surface.configure(&device, &config);

    let renderer = Renderer::new(&device, surface_format)?;
    let game = Game::new();
    let timer = FrameTimer::default();

    let state = Rc::new(RefCell::new(AppState {
        surface,
        config,
        device,
        queue,
        renderer,
        game,
        hud,
        jump_flag,
        canvas,
        timer,
        bg_color: parse_bg_color(),
        raf_closure: None,
        pending_jump: false,
    }));

    start_animation_loop(state)?;

    Ok(())
}

fn start_animation_loop(state: Rc<RefCell<AppState>>) -> Result<()> {
    let win = window().ok_or_else(|| anyhow!("No window"))?;
    let performance = win.performance().ok_or_else(|| anyhow!("No performance"))?;
    let last_time = Rc::new(RefCell::new(performance.now()));

    let closure_state = state.clone();
    let closure_last = last_time.clone();

    let closure = Closure::wrap(Box::new(move |time: f64| {
        let dt = {
            let mut last = closure_last.borrow_mut();
            let dt = ((time - *last) / 1000.0) as f32;
            *last = time;
            dt.max(0.0)
        };

        {
            let mut state = closure_state.borrow_mut();
            if let Err(err) = state.frame(dt) {
                error!("Frame error: {err:#}");
                state
                    .hud
                    .set_inner_text(&format!("WebGPU error\n{err:#}"));
                state.raf_closure = None;
                return;
            }
        }

        if let Some(win) = window() {
            let should_request = {
                let state_ref = closure_state.borrow();
                state_ref.raf_closure.is_some()
            };
            if should_request {
                if let Some(cb) = closure_state
                    .borrow()
                    .raf_closure
                    .as_ref()
                    .map(|c| c.as_ref().unchecked_ref())
                {
                    if win.request_animation_frame(cb).is_err() {
                        error!("Failed to schedule animation frame");
                    }
                }
            }
        }
    }) as Box<dyn FnMut(f64)>);

    {
        let mut state_mut = state.borrow_mut();
        state_mut.raf_closure = Some(closure);
    }

    if let Some(cb) = state
        .borrow()
        .raf_closure
        .as_ref()
        .map(|c| c.as_ref().unchecked_ref())
    {
        win.request_animation_frame(cb)
            .map_err(|_| anyhow!("Failed to request animation frame"))?;
    }
    Ok(())
}

fn canvas_size(canvas: &HtmlCanvasElement) -> (u32, u32) {
    let width = canvas.client_width().max(1) as u32;
    let height = canvas.client_height().max(1) as u32;
    (width, height)
}

struct AppState {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: Renderer,
    game: Game,
    hud: HtmlDivElement,
    jump_flag: Rc<RefCell<bool>>,
    canvas: HtmlCanvasElement,
    timer: FrameTimer,
    bg_color: [f32; 3],
    raf_closure: Option<Closure<dyn FnMut(f64)>>,
    pending_jump: bool,
}

impl AppState {
    fn frame(&mut self, dt: f32) -> Result<()> {
        let want_jump = {
            let mut flag = self.jump_flag.borrow_mut();
            let value = *flag;
            *flag = false;
            value
        };

        if want_jump {
            self.pending_jump = true;
        }

        self.timer.accumulate(dt);

        while self.timer.accumulator >= STEP {
            let jump_now = self.pending_jump;
            self.game.step(STEP, jump_now);
            self.pending_jump = false;
            self.timer.accumulator -= STEP;
        }

        self.timer.update_hud(&self.hud, self.game.score, self.game.is_dead);

        self.resize_if_needed()?;

        let instances = self.game.instance_data(self.config.width, self.config.height);
        match self.renderer.render(
            &self.surface,
            &self.device,
            &self.queue,
            &self.config,
            &instances,
            self.bg_color,
        ) {
            Ok(()) => {}
            Err(wgpu::SurfaceError::Lost) => {
                self.surface.configure(&self.device, &self.config);
            }
            Err(wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
            }
            Err(wgpu::SurfaceError::Timeout) => {
                // Skip this frame silently.
            }
            Err(err) => return Err(anyhow!("Surface error: {err}")),
        }

        Ok(())
    }

    fn resize_if_needed(&mut self) -> Result<()> {
        let (width, height) = canvas_size(&self.canvas);
        if width > 0 && height > 0 && (width != self.config.width || height != self.config.height) {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);
        }
        Ok(())
    }
}

fn parse_bg_color() -> [f32; 3] {
    if let Some(window) = web_sys::window() {
        if let Ok(query) = window.location().search() {
            if let Some(pos) = query.find("bg=") {
                let value = &query[pos + 3..];
                let hex = value.split('&').next().unwrap_or("");
                if hex.len() >= 6 {
                    if let (Ok(r), Ok(g), Ok(b)) = (
                        u8::from_str_radix(&hex[0..2], 16),
                        u8::from_str_radix(&hex[2..4], 16),
                        u8::from_str_radix(&hex[4..6], 16),
                    ) {
                        return [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];
                    }
                }
            }
        }
    }
    [0.36, 0.72, 0.92]
}

#[derive(Default)]
struct FrameTimer {
    accumulator: f32,
    fps_accum: f32,
    fps_frames: u32,
    fps: f32,
}

impl FrameTimer {
    fn accumulate(&mut self, dt: f32) {
        if !dt.is_finite() {
            return;
        }
        self.accumulator += dt;
        self.fps_accum += dt;
        self.fps_frames += 1;
        let max_accum = STEP * 5.0;
        if self.accumulator > max_accum {
            self.accumulator = max_accum;
        }
        if self.fps_accum >= 0.5 {
            self.fps = self.fps_frames as f32 / self.fps_accum.max(1e-5);
            self.fps_accum = 0.0;
            self.fps_frames = 0;
        }
    }

    fn update_hud(&self, hud: &HtmlDivElement, score: i32, dead: bool) {
        let status = if dead { " (DEAD)" } else { "" };
        hud.set_inner_text(&format!("FPS: {:>5.1}\nScore: {}{}", self.fps, score, status));
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct InstanceData {
    position: [f32; 2],
    size: [f32; 2],
    color: [f32; 4],
}

impl InstanceData {
    fn desc<'a>() -> wgpu::VertexBufferLayout<'a> {
        use std::mem;
        wgpu::VertexBufferLayout {
            array_stride: mem::size_of::<InstanceData>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &[
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x2,
                    offset: 0,
                    shader_location: 1,
                },
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x2,
                    offset: 8,
                    shader_location: 2,
                },
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x4,
                    offset: 16,
                    shader_location: 3,
                },
            ],
        }
    }
}

struct Renderer {
    quad_vertex: wgpu::Buffer,
    instance_buffer: wgpu::Buffer,
    instance_capacity: usize,
    bind_group: wgpu::BindGroup,
    pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
}

impl Renderer {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Result<Self> {
        let vertices: [[f32; 2]; 6] = [
            [0.0, 0.0],
            [1.0, 0.0],
            [0.0, 1.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
        ];
        let quad_vertex = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("quad vertices"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });

        let instance_capacity = 64;
        let instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("instance buffer"),
            size: (instance_capacity * std::mem::size_of::<InstanceData>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniform buffer"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("bind group layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("bind group"),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(wgpu::include_wgsl!("shaders/quad.wgsl"));

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("pipeline layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("render pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: "vs_main",
                buffers: &[
                    wgpu::VertexBufferLayout {
                        array_stride: 8,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &[wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 0,
                            shader_location: 0,
                        }],
                    },
                    InstanceData::desc(),
                ],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: "fs_main",
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
        });

        Ok(Self {
            quad_vertex,
            instance_buffer,
            instance_capacity,
            bind_group,
            pipeline,
            uniform_buffer,
        })
    }

    fn ensure_capacity(&mut self, device: &wgpu::Device, count: usize) {
        if count <= self.instance_capacity {
            return;
        }
        self.instance_capacity = (count * 2).next_power_of_two();
        self.instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("instance buffer"),
            size: (self.instance_capacity * std::mem::size_of::<InstanceData>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
    }

    fn render(
        &mut self,
        surface: &wgpu::Surface,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        config: &wgpu::SurfaceConfiguration,
        instances: &[InstanceData],
        bg_color: [f32; 3],
    ) -> Result<(), wgpu::SurfaceError> {
        if instances.is_empty() {
            return Ok(());
        }
        self.ensure_capacity(device, instances.len());
        queue.write_buffer(&self.instance_buffer, 0, bytemuck::cast_slice(instances));

        let screen = [config.width as f32, config.height as f32];
        queue.write_buffer(&self.uniform_buffer, 0, bytemuck::cast_slice(&screen));

        let frame = surface.get_current_texture()?;
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("render encoder"),
        });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: bg_color[0] as f64,
                            g: bg_color[1] as f64,
                            b: bg_color[2] as f64,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.set_vertex_buffer(0, self.quad_vertex.slice(..));
            pass.set_vertex_buffer(1, self.instance_buffer.slice(..));
            pass.draw(0..6, 0..instances.len() as u32);
        }

        queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct PipePair {
    x: f32,
    gap_center: f32,
    passed: bool,
}

struct Game {
    bird_y: f32,
    bird_v: f32,
    is_dead: bool,
    pipes: Vec<PipePair>,
    spawn_timer: f32,
    score: i32,
}

impl Game {
    fn new() -> Self {
        let mut game = Self {
            bird_y: WORLD_HEIGHT / 2.0,
            bird_v: 0.0,
            is_dead: false,
            pipes: Vec::new(),
            spawn_timer: 0.0,
            score: 0,
        };
        game.populate_initial_pipes();
        game
    }

    fn reset(&mut self) {
        self.bird_y = WORLD_HEIGHT / 2.0;
        self.bird_v = 0.0;
        self.is_dead = false;
        self.pipes.clear();
        self.spawn_timer = 0.0;
        self.score = 0;
        self.populate_initial_pipes();
    }

    fn populate_initial_pipes(&mut self) {
        let mut x = WORLD_WIDTH + 40.0;
        for _ in 0..4 {
            self.pipes.push(PipePair {
                x,
                gap_center: random_gap(),
                passed: false,
            });
            x += PIPE_SPACING;
        }
    }

    fn step(&mut self, dt: f32, want_jump: bool) {
        if want_jump {
            if self.is_dead {
                self.reset();
            }
            self.bird_v = FLAP_VELOCITY.max(MAX_RISE_SPEED);
        }

        self.bird_v = (self.bird_v + GRAVITY * dt).clamp(MAX_RISE_SPEED, MAX_FALL_SPEED);
        self.bird_y += self.bird_v * dt;

        if self.bird_y < 0.0 {
            self.bird_y = 0.0;
            self.is_dead = true;
        }

        if self.bird_y + 12.0 >= WORLD_HEIGHT - GROUND_HEIGHT {
            self.is_dead = true;
        }

        if self.is_dead {
            return;
        }

        self.spawn_timer += dt;
        if self.spawn_timer >= PIPE_SPACING / PIPE_SPEED {
            self.spawn_timer -= PIPE_SPACING / PIPE_SPEED;
            self.pipes.push(PipePair {
                x: WORLD_WIDTH + PIPE_WIDTH,
                gap_center: random_gap(),
                passed: false,
            });
        }

        for pipe in &mut self.pipes {
            pipe.x -= PIPE_SPEED * dt;
            if !pipe.passed && pipe.x + PIPE_WIDTH < BIRD_X {
                pipe.passed = true;
                self.score += 1;
            }
        }

        self.pipes.retain(|pipe| pipe.x + PIPE_WIDTH > -80.0);

        for pipe in &self.pipes {
            let half_gap = PIPE_GAP / 2.0;
            if BIRD_X + 17.0 > pipe.x && BIRD_X - 17.0 < pipe.x + PIPE_WIDTH {
                if self.bird_y - 12.0 < pipe.gap_center - half_gap
                    || self.bird_y + 12.0 > pipe.gap_center + half_gap
                {
                    self.is_dead = true;
                    break;
                }
            }
        }
    }

    fn instance_data(&self, screen_w: u32, screen_h: u32) -> Vec<InstanceData> {
        let mut instances = Vec::with_capacity(16 + self.pipes.len() * 2);
        let (scale, offset) = compute_scale_and_offset(screen_w, screen_h);

        // Ground
        instances.push(rect(
            [0.0, WORLD_HEIGHT - GROUND_HEIGHT],
            [WORLD_WIDTH, GROUND_HEIGHT],
            [0.85, 0.74, 0.45, 1.0],
            scale,
            offset,
        ));

        // Bird
        let bird_color = if self.is_dead {
            [0.7, 0.3, 0.3, 1.0]
        } else {
            [1.0, 0.93, 0.0, 1.0]
        };
        instances.push(rect(
            [BIRD_X - 17.0, self.bird_y - 12.0],
            [34.0, 24.0],
            bird_color,
            scale,
            offset,
        ));

        for pipe in &self.pipes {
            let half_gap = PIPE_GAP / 2.0;
            let top_h = (pipe.gap_center - half_gap).max(0.0);
            if top_h > 0.0 {
                instances.push(rect(
                    [pipe.x, 0.0],
                    [PIPE_WIDTH, top_h],
                    [0.37, 0.82, 0.39, 1.0],
                    scale,
                    offset,
                ));
            }
            let bottom_y = pipe.gap_center + half_gap;
            let bottom_h = (WORLD_HEIGHT - bottom_y - GROUND_HEIGHT).max(0.0);
            if bottom_h > 0.0 {
                instances.push(rect(
                    [pipe.x, bottom_y],
                    [PIPE_WIDTH, bottom_h],
                    [0.37, 0.82, 0.39, 1.0],
                    scale,
                    offset,
                ));
            }
        }

        instances
    }
}

fn compute_scale_and_offset(screen_w: u32, screen_h: u32) -> (f32, [f32; 2]) {
    let scale_x = screen_w as f32 / WORLD_WIDTH;
    let scale_y = screen_h as f32 / WORLD_HEIGHT;
    let scale = scale_x.min(scale_y);
    let offset_x = (screen_w as f32 - WORLD_WIDTH * scale) * 0.5;
    let offset_y = (screen_h as f32 - WORLD_HEIGHT * scale) * 0.5;
    (scale, [offset_x, offset_y])
}

fn rect(
    position: [f32; 2],
    size: [f32; 2],
    color: [f32; 4],
    scale: f32,
    offset: [f32; 2],
) -> InstanceData {
    InstanceData {
        position: [position[0] * scale + offset[0], position[1] * scale + offset[1]],
        size: [size[0] * scale, size[1] * scale],
        color,
    }
}

fn random_gap() -> f32 {
    let seed = js_sys::Math::random();
    PIPE_MIN_Y + (PIPE_MAX_Y - PIPE_MIN_Y) * seed as f32
}
