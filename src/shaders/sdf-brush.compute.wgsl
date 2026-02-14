// SDF Brush Compute Shader
// Applies brush operations (add/subtract) to a chunk's SDF volume.
// Each thread processes one voxel sample.

struct BrushUniforms {
  center: vec3<f32>,       // World-space brush end (current position)
  radius: f32,             // Brush radius
  strength: f32,           // Brush strength multiplier
  smoothing: f32,          // Smooth blend parameter (k)
  operation: u32,          // 0 = add, 1 = subtract
  _pad0: u32,
  prev_center: vec3<f32>,  // World-space brush start (previous position)
  _pad1: f32,
  chunk_origin: vec3<f32>, // World-space origin of this chunk
  voxel_size: f32,         // Size of each voxel in world units
  samples_per_axis: u32,   // Number of samples per axis (chunkSize + 1)
  _pad2a: u32,
  _pad2b: u32,
  _pad2c: u32,
}

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(1) var<storage, read_write> sdf_data: array<f32>;

// Smooth minimum for blending SDFs (polynomial)
fn smooth_min(a: f32, b: f32, k: f32) -> f32 {
  if (k <= 0.0) {
    return min(a, b);
  }
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Smooth maximum for subtraction
fn smooth_max(a: f32, b: f32, k: f32) -> f32 {
  return -smooth_min(-a, -b, k);
}

// Capsule SDF: line segment from a to b with radius r
fn capsule_sdf(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, radius: f32) -> f32 {
  let ab = b - a;
  let ap = p - a;
  let t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
  return length(ap - ab * t) - radius;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let ix = global_id.x;
  let iy = global_id.y;
  let iz = global_id.z;
  let s = brush.samples_per_axis;

  // Bounds check
  if (ix >= s || iy >= s || iz >= s) {
    return;
  }

  // Flat index into SDF buffer
  let idx = iz * s * s + iy * s + ix;

  // World position of this sample
  let world_pos = brush.chunk_origin + vec3<f32>(
    f32(ix) * brush.voxel_size,
    f32(iy) * brush.voxel_size,
    f32(iz) * brush.voxel_size
  );

  // Early exit: if sample is far from capsule brush, skip
  let ab = brush.center - brush.prev_center;
  let ap = world_pos - brush.prev_center;
  let t_proj = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
  let dist_to_brush = length(ap - ab * t_proj);
  let influence_radius = brush.radius + brush.smoothing * 2.0;
  if (dist_to_brush > influence_radius) {
    return;
  }

  // Capsule SDF: line segment from prev_center to center with brush radius
  let brush_sdf = capsule_sdf(world_pos, brush.prev_center, brush.center, brush.radius * brush.strength);
  let current_sdf = sdf_data[idx];
  var new_sdf: f32;

  if (brush.operation == 0u) {
    // Add: smooth union
    new_sdf = smooth_min(current_sdf, brush_sdf, brush.smoothing);
  } else {
    // Subtract: smooth subtraction
    new_sdf = smooth_max(current_sdf, -brush_sdf, brush.smoothing);
  }

  sdf_data[idx] = new_sdf;
}
