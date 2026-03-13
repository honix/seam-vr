// SDF Smooth Compute Shader
// Laplacian smoothing of SDF values within brush influence.
// Reads from a padded center+neighbor snapshot and writes one output chunk.
// Each thread processes one voxel sample.

struct BrushUniforms {
  center: vec3<f32>,       // World-space brush end (current position)
  radius: f32,             // Brush radius
  strength: f32,           // Smooth strength multiplier
  smoothing: f32,          // Falloff margin beyond radius
  operation: u32,          // Unused for smooth (kept for struct compatibility)
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
@group(0) @binding(1) var<storage, read> padded_sdf: array<f32>;
@group(0) @binding(2) var<storage, read_write> sdf_out: array<f32>;

@compute @workgroup_size(8, 4, 4)
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
  let p = s + 2u;
  let px = ix + 1u;
  let py = iy + 1u;
  let pz = iz + 1u;
  let padded_idx = pz * p * p + py * p + px;

  // World position of this sample
  let world_pos = brush.chunk_origin + vec3<f32>(
    f32(ix) * brush.voxel_size,
    f32(iy) * brush.voxel_size,
    f32(iz) * brush.voxel_size
  );

  // Capsule distance: line segment from prev_center to center
  let ab = brush.center - brush.prev_center;
  let ap = world_pos - brush.prev_center;
  let t_proj = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
  let dist = length(ap - ab * t_proj);

  let influence_radius = brush.radius + brush.smoothing;

  // Early exit: outside brush influence — pass through unchanged
  if (dist > influence_radius) {
    sdf_out[idx] = padded_sdf[padded_idx];
    return;
  }

  // Smooth falloff weight: 1.0 at center, 0.0 at edge
  let weight = smoothstep(influence_radius, brush.radius * 0.5, dist);

  // Read current value
  let current = padded_sdf[padded_idx];

  // Read 6 direct neighbors from the padded source so chunk faces can see their face neighbors.
  let idx_xm = pz * p * p + py * p + (px - 1u);
  let idx_xp = pz * p * p + py * p + (px + 1u);
  let idx_ym = pz * p * p + (py - 1u) * p + px;
  let idx_yp = pz * p * p + (py + 1u) * p + px;
  let idx_zm = (pz - 1u) * p * p + py * p + px;
  let idx_zp = (pz + 1u) * p * p + py * p + px;

  let neighbor_avg = (
    padded_sdf[idx_xm] + padded_sdf[idx_xp] +
    padded_sdf[idx_ym] + padded_sdf[idx_yp] +
    padded_sdf[idx_zm] + padded_sdf[idx_zp]
  ) / 6.0;

  // Blend toward neighbor average, weighted by distance falloff and strength
  let new_value = mix(current, neighbor_avg, weight * brush.strength);

  sdf_out[idx] = new_value;
}
