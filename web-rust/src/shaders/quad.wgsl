struct Screen {
    size: vec2<f32>;
};

@group(0) @binding(0)
var<uniform> screen: Screen;

struct VertexInput {
    @location(0) quad_pos: vec2<f32>;
    @location(1) instance_pos: vec2<f32>;
    @location(2) instance_size: vec2<f32>;
    @location(3) instance_color: vec4<f32>;
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>;
    @location(0) color: vec4<f32>;
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    let pixel = in.instance_pos + in.quad_pos * in.instance_size;
    let ndc = vec2<f32>(
        pixel.x / screen.size.x * 2.0 - 1.0,
        1.0 - pixel.y / screen.size.y * 2.0,
    );
    var out: VertexOutput;
    out.position = vec4<f32>(ndc, 0.0, 1.0);
    out.color = in.instance_color;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return in.color;
}
