// Seam VR - GPU Vertex Deformer Shader
// Applies up to 8 deformers in sequence to vertex positions in object space.
// Each deformer block: [type, param0, param1, param2, param3, param4, param5, param6]
// Types: 0=none, 1=bend, 2=taper, 3=twist, 4=lattice(stub), 5=noise

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_position: vec3<f32>,
  @location(1) world_normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct CameraUniforms {
  view: mat4x4<f32>,
  projection: mat4x4<f32>,
};

struct ModelUniforms {
  model: mat4x4<f32>,
  normal_matrix: mat4x4<f32>,
};

// 8 deformers * 8 floats each = 64 floats = 16 vec4s
struct DeformerUniforms {
  blocks: array<vec4<f32>, 16>,
  count: u32,
  object_min: vec3<f32>,
  object_max: vec3<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<uniform> model: ModelUniforms;
@group(2) @binding(0) var<uniform> deformers: DeformerUniforms;

// --- Deformer math functions ---

fn apply_bend(pos: vec3<f32>, params: vec4<f32>, params2: vec4<f32>) -> vec3<f32> {
  let angle_rad = params.x;
  let axis_idx = u32(params.y);
  let center = params.z;
  var p = pos;

  let obj_min = deformers.object_min;
  let obj_max = deformers.object_max;

  // Determine primary and secondary axis indices
  let primary = axis_idx;
  var secondary: u32;
  if (axis_idx == 0u) { secondary = 2u; }
  else if (axis_idx == 1u) { secondary = 2u; }
  else { secondary = 1u; }

  let extent = obj_max[primary] - obj_min[primary];
  if (extent < 0.0001) { return p; }

  let R = extent / angle_rad;
  let dp = p[primary] - center;
  let bend_angle = dp / R;
  let cos_a = cos(bend_angle);
  let sin_a = sin(bend_angle);
  let r = R + p[secondary];

  var result = p;
  result[primary] = center + r * sin_a;
  result[secondary] = r * cos_a - R;
  return result;
}

fn apply_taper(pos: vec3<f32>, params: vec4<f32>) -> vec3<f32> {
  let factor = params.x;
  let axis_idx = u32(params.y);
  var p = pos;

  let obj_min = deformers.object_min;
  let obj_max = deformers.object_max;

  let extent = obj_max[axis_idx] - obj_min[axis_idx];
  if (extent < 0.0001) { return p; }

  let t = (p[axis_idx] - obj_min[axis_idx]) / extent;
  let scale = 1.0 + (factor - 1.0) * t;

  let cross1 = (axis_idx + 1u) % 3u;
  let cross2 = (axis_idx + 2u) % 3u;
  var result = p;
  result[cross1] = p[cross1] * scale;
  result[cross2] = p[cross2] * scale;
  return result;
}

fn apply_twist(pos: vec3<f32>, params: vec4<f32>) -> vec3<f32> {
  let angle_rad = params.x;
  let axis_idx = u32(params.y);
  var p = pos;

  let obj_min = deformers.object_min;
  let obj_max = deformers.object_max;

  let extent = obj_max[axis_idx] - obj_min[axis_idx];
  if (extent < 0.0001) { return p; }

  let t = (p[axis_idx] - obj_min[axis_idx]) / extent;
  let theta = t * angle_rad;
  let cos_t = cos(theta);
  let sin_t = sin(theta);

  let cross1 = (axis_idx + 1u) % 3u;
  let cross2 = (axis_idx + 2u) % 3u;

  let a = p[cross1];
  let b = p[cross2];

  var result = p;
  result[cross1] = a * cos_t - b * sin_t;
  result[cross2] = a * sin_t + b * cos_t;
  return result;
}

fn hash_3d(x: f32, y: f32, z: f32, seed: f32) -> f32 {
  let ix = bitcast<u32>(i32(x * 1000000.0));
  let iy = bitcast<u32>(i32(y * 1000000.0));
  let iz = bitcast<u32>(i32(z * 1000000.0));
  let is = bitcast<u32>(i32(seed));
  var h = is ^ (ix * 0x45d9f3bu);
  h = (h >> 16u) ^ h;
  h = h ^ (iy * 0x45d9f3bu);
  h = (h >> 16u) ^ h;
  h = h ^ (iz * 0x119de1f3u);
  h = (h >> 16u) ^ h;
  return f32(h & 0x7fffffffu) / f32(0x7fffffffu) * 2.0 - 1.0;
}

fn smooth_noise(x: f32, y: f32, z: f32, seed: f32) -> f32 {
  let ix = floor(x);
  let iy = floor(y);
  let iz = floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  let sx = fx * fx * (3.0 - 2.0 * fx);
  let sy = fy * fy * (3.0 - 2.0 * fy);
  let sz = fz * fz * (3.0 - 2.0 * fz);

  let n000 = hash_3d(ix, iy, iz, seed);
  let n100 = hash_3d(ix + 1.0, iy, iz, seed);
  let n010 = hash_3d(ix, iy + 1.0, iz, seed);
  let n110 = hash_3d(ix + 1.0, iy + 1.0, iz, seed);
  let n001 = hash_3d(ix, iy, iz + 1.0, seed);
  let n101 = hash_3d(ix + 1.0, iy, iz + 1.0, seed);
  let n011 = hash_3d(ix, iy + 1.0, iz + 1.0, seed);
  let n111 = hash_3d(ix + 1.0, iy + 1.0, iz + 1.0, seed);

  let nx00 = n000 + sx * (n100 - n000);
  let nx10 = n010 + sx * (n110 - n010);
  let nx01 = n001 + sx * (n101 - n001);
  let nx11 = n011 + sx * (n111 - n011);
  let nxy0 = nx00 + sy * (nx10 - nx00);
  let nxy1 = nx01 + sy * (nx11 - nx01);
  return nxy0 + sz * (nxy1 - nxy0);
}

fn apply_noise(pos: vec3<f32>, normal: vec3<f32>, params: vec4<f32>) -> vec3<f32> {
  let amplitude = params.x;
  let frequency = params.y;
  let seed = params.z;

  let sp = pos * frequency;
  let n = smooth_noise(sp.x, sp.y, sp.z, seed);
  let displacement = n * amplitude;
  return pos + normal * displacement;
}

// --- Approximate normal recalculation ---
// Finite difference approach: deform position + small offset, compute tangent
fn recalc_normal(pos: vec3<f32>, original_normal: vec3<f32>) -> vec3<f32> {
  // For GPU path, normals are recalculated via finite differences in a compute pass
  // or via the normal matrix. This is a simplified placeholder that returns the
  // original normal - proper normal recalc requires neighbor vertex access.
  return normalize(original_normal);
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var pos = input.position;
  var normal = input.normal;

  // Apply each active deformer in sequence
  for (var i = 0u; i < deformers.count; i = i + 1u) {
    let block_idx = i * 2u;
    let params = deformers.blocks[block_idx];
    let params2 = deformers.blocks[block_idx + 1u];
    let deformer_type = u32(params.x);

    // Extract per-deformer params (shift out type from first component)
    let dp = vec4<f32>(params.y, params.z, params.w, params2.x);

    switch deformer_type {
      case 1u: { // Bend
        pos = apply_bend(pos, dp, params2);
      }
      case 2u: { // Taper
        pos = apply_taper(pos, dp);
      }
      case 3u: { // Twist
        pos = apply_twist(pos, dp);
      }
      // case 4u: Lattice - requires separate buffer, not handled in uber-shader
      case 5u: { // Noise
        pos = apply_noise(pos, normal, dp);
      }
      default: {}
    }
  }

  let world_pos = model.model * vec4<f32>(pos, 1.0);
  let world_norm = normalize((model.normal_matrix * vec4<f32>(normal, 0.0)).xyz);

  var output: VertexOutput;
  output.clip_position = camera.projection * camera.view * world_pos;
  output.world_position = world_pos.xyz;
  output.world_normal = world_norm;
  output.uv = input.uv;
  return output;
}
