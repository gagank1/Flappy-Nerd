mod game;
mod hud;

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{anyhow, Result};
use game::{Game, InstanceData, Palette, FIXED_STEP};
use hud::Hud;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{window, HtmlCanvasElement};

#[wasm_bindgen]
pub fn trigger_jump() {
    WANT_FLAP.store(true, Ordering::SeqCst);
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
    wasm_bindgen_futures::spawn_local(async {
        if let Err(err) = App::boot().await {
            report_boot_error(&err.to_string());
        }
    });
}

static WANT_FLAP: AtomicBool = AtomicBool::new(false);
const MAX_DT: f64 = 0.25;

fn report_boot_error(message: &str) {
    if let Some(window) = window() {
        if let Some(document) = window.document() {
            if let Ok(status) = document.create_element("div") {
                let _ = status.set_attribute(
                    "style",
                    "position:fixed;top:16px;left:16px;color:#ff8080;font-family:sans-serif;font-size:16px;z-index:2000;",
                );
                status.set_text_content(Some(message));
                let _ = document.body().map(|body| body.append_child(&status));
            }
        }
    }
    web_sys::console::error_1(&message.into());
}

struct App {
    window: web_sys::Window,
    canvas: HtmlCanvasElement,
    surface: wgpu::Surface,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    uniform_buffer: wgpu::Buffer,
    uniform_bind_group: wgpu::BindGroup,
    pipeline: wgpu::RenderPipeline,
    instance_buffer: wgpu::Buffer,
    instance_capacity: usize,
    game: Game,
    hud: Hud,
    fps: FpsCounter,
    time_state: TimeState,
    pending_flap: bool,
    event_handles: Vec<ClosureHolder>,
    raf_closure: Option<Rc<RefCell<Option<Closure<dyn FnMut(f64)>>>>>,
    options: Options,
}

struct ClosureHolder {
    target: web_sys::EventTarget,
    event_name: String,
    closure: Closure<dyn FnMut(web_sys::Event)>,
}

impl Drop for ClosureHolder {
    fn drop(&mut self) {
        let _ = self.target.remove_event_listener_with_callback(
            &self.event_name,
            self.closure.as_ref().unchecked_ref(),
        );
    }
}

struct TimeState {
    last_frame: Option<f64>,
    accumulator: f64,
}

impl TimeState {
    fn new() -> Self {
        Self {
            last_frame: None,
            accumulator: 0.0,
        }
    }

    fn advance(&mut self, time: f64) -> f64 {
        let dt = if let Some(prev) = self.last_frame {
            let mut delta = (time - prev) / 1000.0;
            if !delta.is_finite() {
                delta = 0.0;
            }
            delta = delta.clamp(0.0, MAX_DT);
            self.accumulator += delta;
            delta
        } else {
            self.last_frame = Some(time);
            return 0.0;
        };
        self.last_frame = Some(time);
        dt
    }
}

struct FpsCounter {
    frames: u32,
    elapsed: f64,
    fps: f32,
}

impl FpsCounter {
    fn new() -> Self {
        Self {
            frames: 0,
            elapsed: 0.0,
            fps: 0.0,
        }
    }

    fn update(&mut self, dt: f64) -> f32 {
        self.frames += 1;
        self.elapsed += dt;
        if self.elapsed >= 0.5 {
            self.fps = (self.frames as f64 / self.elapsed) as f32;
            self.frames = 0;
            self.elapsed = 0.0;
        }
        self.fps
    }
}

struct Options {
    prefer_immediate: bool,
    background: Option<[f32; 4]>,
}

impl Options {
    fn from_window(window: &web_sys::Window) -> Self {
        let mut opts = Options {
            prefer_immediate: false,
            background: None,
        };
        if let Ok(location) = window.location().search() {
            for segment in location.trim_start_matches('?').split('&') {
                if segment.is_empty() {
                    continue;
                }
                let mut parts = segment.splitn(2, '=');
                let key = parts.next().unwrap_or("");
                let value = parts.next().unwrap_or("");
                match key {
                    "uncapped" if value == "1" => opts.prefer_immediate = true,
                    "bg" => {
                        if let Some(color) = parse_hex_color(value) {
                            opts.background = Some(color);
                        }
                    }
                    _ => {}
                }
            }
        }
        opts
    }
}

impl App {
    async fn boot() -> Result<()> {
        let window = window().ok_or_else(|| anyhow!("missing window"))?;
        let document = window
            .document()
            .ok_or_else(|| anyhow!("missing document"))?;
        let canvas = document
            .get_element_by_id("flappy-canvas")
            .ok_or_else(|| anyhow!("missing canvas #flappy-canvas"))?
            .dyn_into::<HtmlCanvasElement>()?;
        canvas.set_tab_index(0);

        let hud = Hud::new(&document)?;
        let options = Options::from_window(&window);

        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
            .map_err(|_| anyhow!("WebGPU surface creation failed"))?;

        let Some(adapter) = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
        else {
            hud.set_error("WebGPU not available in this browser");
            return Ok(());
        };

        let limits = wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits());
        let (device, queue) = match adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Flappy Nerd Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: limits,
                    memory_hints: Default::default(),
                },
                None,
            )
            .await
        {
            Ok(result) => result,
            Err(err) => {
                hud.set_error("Failed to initialize WebGPU device");
                web_sys::console::error_1(&err);
                return Ok(());
            }
        };

        let capabilities = surface.get_capabilities(&adapter);
        let format = capabilities
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .unwrap_or(capabilities.formats[0]);
        let present_mode = if options.prefer_immediate
            && capabilities
                .present_modes
                .iter()
                .any(|mode| *mode == wgpu::PresentMode::Immediate)
        {
            wgpu::PresentMode::Immediate
        } else {
            wgpu::PresentMode::Fifo
        };
        let alpha_mode = capabilities
            .alpha_modes
            .iter()
            .copied()
            .find(|mode| matches!(mode, wgpu::CompositeAlphaMode::Opaque))
            .unwrap_or(capabilities.alpha_modes[0]);

        resize_canvas_to_window(&window, &canvas);
        let (width, height) = canvas_size(&canvas);

        let mut config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode,
            alpha_mode,
            view_formats: vec![],
        };
        surface.configure(&device, &config);

        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Uniform Buffer"),
            size: std::mem::size_of::<GpuUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let uniform_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Uniforms Layout"),
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

        let uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Uniform Bind Group"),
            layout: &uniform_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Quad Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/quad.wgsl").into()),
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Pipeline Layout"),
            bind_group_layouts: &[&uniform_bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Quad Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: "vs_main",
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<GpuInstance>() as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &[
                        wgpu::VertexAttribute {
                            offset: 0,
                            shader_location: 0,
                            format: wgpu::VertexFormat::Float32x2,
                        },
                        wgpu::VertexAttribute {
                            offset: 8,
                            shader_location: 1,
                            format: wgpu::VertexFormat::Float32x2,
                        },
                        wgpu::VertexAttribute {
                            offset: 16,
                            shader_location: 2,
                            format: wgpu::VertexFormat::Float32x4,
                        },
                    ],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: "fs_main",
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
        });

        let instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Instance Buffer"),
            size: 1024,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let mut game = Game::new(Palette::default());
        if let Some(bg) = options.background {
            game.set_background(bg);
        }
        game.resize(width as f32, height as f32);

        let mut app = App {
            window: window.clone(),
            canvas: canvas.clone(),
            surface,
            device,
            queue,
            config,
            uniform_buffer,
            uniform_bind_group,
            pipeline,
            instance_buffer,
            instance_capacity: (1024 / std::mem::size_of::<GpuInstance>()) as usize,
            game,
            hud,
            fps: FpsCounter::new(),
            time_state: TimeState::new(),
            pending_flap: false,
            event_handles: Vec::new(),
            raf_closure: None,
            options,
        };

        app.update_uniforms()?;
        app.register_inputs()?;

        let rc = Rc::new(RefCell::new(app));
        App::start_loop(rc.clone());
        Ok(())
    }

    fn start_loop(app: Rc<RefCell<App>>) {
        let f = Rc::new(RefCell::new(None));
        let g = f.clone();
        let window = app.borrow().window.clone();
        *g.borrow_mut() = Some(Closure::wrap(Box::new(move |time: f64| {
            {
                let mut app_mut = app.borrow_mut();
                if let Err(err) = app_mut.frame(time) {
                    app_mut.hud.set_error(&format!("{}", err));
                    return;
                }
            }
            if let Some(callback) = g.borrow().as_ref() {
                let _ = window.request_animation_frame(callback.as_ref().unchecked_ref());
            }
        }) as Box<dyn FnMut(f64)>));

        if let Some(callback) = g.borrow().as_ref() {
            if window
                .request_animation_frame(callback.as_ref().unchecked_ref())
                .is_ok()
            {
                app.borrow_mut().raf_closure = Some(g);
            }
        }
    }

    fn frame(&mut self, time: f64) -> Result<()> {
        let dt = self.time_state.advance(time);
        let mut delta = self.time_state.accumulator;
        self.pending_flap |= WANT_FLAP.swap(false, Ordering::SeqCst);

        while delta >= FIXED_STEP as f64 {
            let flap = if self.pending_flap {
                self.pending_flap = false;
                true
            } else {
                false
            };
            self.game.step(FIXED_STEP, flap);
            delta -= FIXED_STEP as f64;
        }
        self.time_state.accumulator = delta;

        self.resize_if_needed()?;
        let fps = self.fps.update(dt);
        self.hud.set_fps(fps);
        self.hud
            .set_score(self.game.score(), self.game.best_score());
        self.hud.set_status(self.game.status_text());

        let instance_count = self.upload_instances()?;
        self.draw(instance_count)?;
        Ok(())
    }

    fn resize_if_needed(&mut self) -> Result<()> {
        let previous = (self.config.width, self.config.height);
        resize_canvas_to_window(&self.window, &self.canvas);
        let (width, height) = canvas_size(&self.canvas);
        if width == 0 || height == 0 {
            return Ok(());
        }
        if previous != (width, height) {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);
            self.game.resize(width as f32, height as f32);
            self.update_uniforms()?;
        }
        Ok(())
    }

    fn update_uniforms(&mut self) -> Result<()> {
        let uniforms = GpuUniforms {
            screen: [self.config.width as f32, self.config.height as f32],
            _pad: [0.0; 2],
        };
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
        Ok(())
    }

    fn upload_instances(&mut self) -> Result<u32> {
        let mut instances = self.game.instances();
        if instances.is_empty() {
            return Ok(0);
        }
        let required = instances.len();
        self.ensure_instance_capacity(required);

        let mut gpu_instances = Vec::with_capacity(required);
        for InstanceData { pos, size, color } in instances.drain(..) {
            gpu_instances.push(GpuInstance {
                pos,
                size,
                color: srgb_to_linear(color),
            });
        }

        let bytes = bytemuck::cast_slice(&gpu_instances);
        self.queue.write_buffer(&self.instance_buffer, 0, bytes);
        Ok(required as u32)
    }

    fn ensure_instance_capacity(&mut self, required: usize) {
        if required <= self.instance_capacity {
            return;
        }
        let mut new_capacity = self.instance_capacity.max(1);
        let stride = std::mem::size_of::<GpuInstance>() as u64;
        while new_capacity < required {
            new_capacity *= 2;
        }
        let new_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Instance Buffer"),
            size: stride * new_capacity as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.instance_buffer = new_buffer;
        self.instance_capacity = new_capacity;
    }

    fn draw(&mut self, instance_count: u32) -> Result<()> {
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(err) => match err {
                wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated => {
                    self.surface.configure(&self.device, &self.config);
                    return Ok(());
                }
                wgpu::SurfaceError::OutOfMemory => {
                    return Err(anyhow!("Surface out of memory"));
                }
                wgpu::SurfaceError::Timeout => {
                    return Ok(());
                }
            },
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Render Encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: true,
                    },
                })],
                depth_stencil_attachment: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.uniform_bind_group, &[]);
            pass.set_vertex_buffer(0, self.instance_buffer.slice(..));
            pass.draw(0..6, 0..instance_count);
        }
        self.queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }

    fn register_inputs(&mut self) -> Result<()> {
        let target: web_sys::EventTarget = self.window.clone().into();
        let window_handle = self.make_listener(&target, "keydown", |event| {
            let event = event.dyn_into::<web_sys::KeyboardEvent>().unwrap();
            if event.repeat() {
                return;
            }
            let key = event.key();
            if key == " " || key == "Space" || key.eq_ignore_ascii_case("spacebar") {
                event.prevent_default();
                WANT_FLAP.store(true, Ordering::SeqCst);
            }
        });
        self.event_handles.push(window_handle);

        let canvas_target: web_sys::EventTarget = self.canvas.clone().into();
        let canvas_for_focus = self.canvas.clone();
        let pointer_handle = self.make_listener(&canvas_target, "pointerdown", move |_event| {
            let _ = canvas_for_focus.focus();
            WANT_FLAP.store(true, Ordering::SeqCst);
        });
        self.event_handles.push(pointer_handle);

        let canvas_for_touch = self.canvas.clone();
        let touch_handle = self.make_listener(&canvas_target, "touchstart", move |event| {
            event.prevent_default();
            let _ = canvas_for_touch.focus();
            WANT_FLAP.store(true, Ordering::SeqCst);
        });
        self.event_handles.push(touch_handle);

        Ok(())
    }

    fn make_listener<F>(
        &self,
        target: &web_sys::EventTarget,
        event_name: &str,
        handler: F,
    ) -> ClosureHolder
    where
        F: 'static + FnMut(web_sys::Event),
    {
        let closure = Closure::wrap(Box::new(handler) as Box<dyn FnMut(_)>);
        let _ =
            target.add_event_listener_with_callback(event_name, closure.as_ref().unchecked_ref());
        ClosureHolder {
            target: target.clone(),
            event_name: event_name.to_string(),
            closure,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuInstance {
    pos: [f32; 2],
    size: [f32; 2],
    color: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuUniforms {
    screen: [f32; 2],
    _pad: [f32; 2],
}

fn canvas_size(canvas: &HtmlCanvasElement) -> (u32, u32) {
    (canvas.width(), canvas.height())
}

fn resize_canvas_to_window(window: &web_sys::Window, canvas: &HtmlCanvasElement) {
    let mut width = canvas.client_width() as f64;
    let mut height = canvas.client_height() as f64;
    if width <= 0.0 || height <= 0.0 {
        width = window
            .inner_width()
            .ok()
            .and_then(|v| v.as_f64())
            .unwrap_or(1280.0);
        height = window
            .inner_height()
            .ok()
            .and_then(|v| v.as_f64())
            .unwrap_or(720.0);
        let _ = canvas
            .style()
            .set_property("width", &format!("{}px", width));
        let _ = canvas
            .style()
            .set_property("height", &format!("{}px", height));
    }
    let dpr = window.device_pixel_ratio();
    let target_width = (width * dpr).round().max(1.0);
    let target_height = (height * dpr).round().max(1.0);
    canvas.set_width(target_width as u32);
    canvas.set_height(target_height as u32);
}

fn srgb_to_linear(color: [f32; 4]) -> [f32; 4] {
    [
        srgb_channel_to_linear(color[0]),
        srgb_channel_to_linear(color[1]),
        srgb_channel_to_linear(color[2]),
        color[3],
    ]
}

fn srgb_channel_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn parse_hex_color(value: &str) -> Option<[f32; 4]> {
    let value = value.trim();
    let hex = value.strip_prefix('#').unwrap_or(value);
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some([r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 1.0])
}
