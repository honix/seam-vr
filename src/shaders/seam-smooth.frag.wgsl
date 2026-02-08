// Seam VR - Screen-Space Normal Smoothing Fragment Shader
// Blends normals at primitive seam boundaries where depth is similar but normals diverge.
// This hides the hard edges between composed primitives.

struct FragmentInput {
  @location(0) uv: vec2<f32>,
};

struct SeamSmoothUniforms {
  blend_radius: i32,      // Kernel half-size (e.g., 2 = 5x5 kernel)
  depth_threshold: f32,   // Max depth difference to consider "same surface"
  normal_threshold: f32,  // Min normal difference to trigger blending
  screen_size: vec2<f32>, // Width, height in pixels
};

@group(0) @binding(0) var color_tex: texture_2d<f32>;
@group(0) @binding(1) var depth_tex: texture_2d<f32>;
@group(0) @binding(2) var normal_tex: texture_2d<f32>;
@group(0) @binding(3) var tex_sampler: sampler;
@group(1) @binding(0) var<uniform> params: SeamSmoothUniforms;

// Linearize depth from clip space
fn linearize_depth(d: f32, near: f32, far: f32) -> f32 {
  return near * far / (far - d * (far - near));
}

// Simple directional lighting recomputation with smoothed normal
fn relight(color: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
  let light_dir = normalize(vec3<f32>(0.36, 0.72, 0.50));
  let ndl = max(dot(normal, light_dir), 0.0);
  let ambient = 0.3;
  // Approximate relighting: scale color by new lighting / original avg lighting
  return color * (ambient + ndl * 0.7);
}

@fragment
fn fs_main(input: FragmentInput) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let texel_size = vec2<f32>(1.0) / params.screen_size;

  let center_color = textureSample(color_tex, tex_sampler, uv);
  let center_depth = textureSample(depth_tex, tex_sampler, uv).r;
  let center_normal = textureSample(normal_tex, tex_sampler, uv).xyz * 2.0 - 1.0;

  // If no blend radius or the pixel has no geometry, pass through
  if (params.blend_radius <= 0 || center_depth >= 1.0) {
    return center_color;
  }

  var blended_normal = center_normal;
  var total_weight = 1.0;
  var is_seam = false;

  let radius = params.blend_radius;

  // Sample kernel neighbors
  for (var dy = -radius; dy <= radius; dy = dy + 1) {
    for (var dx = -radius; dx <= radius; dx = dx + 1) {
      if (dx == 0 && dy == 0) { continue; }

      let offset = vec2<f32>(f32(dx), f32(dy)) * texel_size;
      let sample_uv = uv + offset;

      let sample_depth = textureSample(depth_tex, tex_sampler, sample_uv).r;
      let sample_normal = textureSample(normal_tex, tex_sampler, sample_uv).xyz * 2.0 - 1.0;

      // Check if neighbor is at similar depth (same surface region)
      let depth_diff = abs(center_depth - sample_depth);
      if (depth_diff > params.depth_threshold) { continue; }

      // Check if normals differ significantly (potential seam)
      let normal_diff = 1.0 - dot(center_normal, sample_normal);
      if (normal_diff > params.normal_threshold) {
        is_seam = true;
      }

      // Gaussian-like weight based on distance
      let dist = length(vec2<f32>(f32(dx), f32(dy)));
      let weight = exp(-dist * dist / (f32(radius) * f32(radius) * 0.5));

      blended_normal = blended_normal + sample_normal * weight;
      total_weight = total_weight + weight;
    }
  }

  // Only apply smoothing at seam pixels
  if (!is_seam) {
    return center_color;
  }

  blended_normal = normalize(blended_normal / total_weight);

  // Relight with smoothed normal
  let smoothed_color = relight(center_color.rgb, blended_normal);
  return vec4<f32>(smoothed_color, center_color.a);
}
