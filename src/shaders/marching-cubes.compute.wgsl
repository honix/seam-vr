// Marching Cubes Compute Shader
// Extracts triangle mesh from SDF volume data.
// Each thread processes one cell (defined by 8 corner samples).
// Outputs vertices with positions and normals using atomic append.
//
// SDF buffer is padded with 1 extra sample on each face (from neighbor chunks)
// so gradient/normal computation at chunk boundaries is seamless.

struct MCUniforms {
  chunk_origin: vec3<f32>,  // World-space origin of this chunk
  voxel_size: f32,          // Size of each voxel
  cells_per_axis: u32,      // Number of cells per axis (chunkSize)
  samples_per_axis: u32,    // cells_per_axis + 1
  iso_level: f32,           // Iso-surface threshold (typically 0)
  sdf_stride: u32,          // Stride for padded SDF buffer (samples_per_axis + 2)
}

struct Vertex {
  position: vec3<f32>,
  normal: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: MCUniforms;
@group(0) @binding(1) var<storage, read> sdf_data: array<f32>;
@group(0) @binding(2) var<storage, read> edge_table: array<u32>;     // 256 entries
@group(0) @binding(3) var<storage, read> tri_table: array<i32>;      // 256 * 16 entries
@group(0) @binding(4) var<storage, read_write> vertices: array<f32>; // output: x,y,z,nx,ny,nz per vertex
@group(0) @binding(5) var<storage, read_write> counter: atomic<u32>; // vertex counter

// Cube corner offsets (vertex index -> dx,dy,dz)
const CUBE_CORNERS = array<vec3<u32>, 8>(
  vec3<u32>(0u, 0u, 0u), // 0
  vec3<u32>(1u, 0u, 0u), // 1
  vec3<u32>(1u, 1u, 0u), // 2
  vec3<u32>(0u, 1u, 0u), // 3
  vec3<u32>(0u, 0u, 1u), // 4
  vec3<u32>(1u, 0u, 1u), // 5
  vec3<u32>(1u, 1u, 1u), // 6
  vec3<u32>(0u, 1u, 1u), // 7
);

// Edge endpoint indices (edge index -> [vertex_a, vertex_b])
const EDGE_A = array<u32, 12>(0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u, 0u, 1u, 2u, 3u);
const EDGE_B = array<u32, 12>(1u, 2u, 3u, 0u, 5u, 6u, 7u, 4u, 4u, 5u, 6u, 7u);

// Access the padded SDF buffer directly using padded coordinates
fn get_sdf_padded(px: u32, py: u32, pz: u32) -> f32 {
  let s = uniforms.sdf_stride;
  return sdf_data[pz * s * s + py * s + px];
}

// Get SDF value at chunk-local sample coordinates (0-based)
// Adds +1 offset to index into the padded buffer
fn get_sdf(ix: u32, iy: u32, iz: u32) -> f32 {
  return get_sdf_padded(ix + 1u, iy + 1u, iz + 1u);
}

// Compute gradient (normal) via central differences using padded buffer
// No clamping needed — padding guarantees valid neighbors on all sides
fn compute_gradient(ix: u32, iy: u32, iz: u32) -> vec3<f32> {
  // Padded coordinates for this sample
  let px = ix + 1u;
  let py = iy + 1u;
  let pz = iz + 1u;

  let gx = get_sdf_padded(px + 1u, py, pz) - get_sdf_padded(px - 1u, py, pz);
  let gy = get_sdf_padded(px, py + 1u, pz) - get_sdf_padded(px, py - 1u, pz);
  let gz = get_sdf_padded(px, py, pz + 1u) - get_sdf_padded(px, py, pz - 1u);

  let grad = vec3<f32>(gx, gy, gz);
  let len = length(grad);
  if (len < 1e-8) {
    return vec3<f32>(0.0, 1.0, 0.0);
  }
  return grad / len;
}

// Interpolate position on edge between two corners
fn interp_position(
  p1: vec3<f32>, p2: vec3<f32>,
  v1: f32, v2: f32
) -> vec3<f32> {
  let iso = uniforms.iso_level;
  if (abs(v1 - v2) < 1e-10) {
    return p1;
  }
  let t = (iso - v1) / (v2 - v1);
  return p1 + t * (p2 - p1);
}

// Interpolate normal between two sample points
fn interp_normal(
  s1: vec3<u32>, s2: vec3<u32>,
  v1: f32, v2: f32
) -> vec3<f32> {
  let iso = uniforms.iso_level;
  var t: f32;
  if (abs(v1 - v2) < 1e-10) {
    t = 0.5;
  } else {
    t = (iso - v1) / (v2 - v1);
  }
  let n1 = compute_gradient(s1.x, s1.y, s1.z);
  let n2 = compute_gradient(s2.x, s2.y, s2.z);
  let n = n1 + t * (n2 - n1);
  let len = length(n);
  if (len < 1e-8) {
    return vec3<f32>(0.0, 1.0, 0.0);
  }
  return n / len;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let cx = global_id.x;
  let cy = global_id.y;
  let cz = global_id.z;
  let cells = uniforms.cells_per_axis;

  // Bounds check
  if (cx >= cells || cy >= cells || cz >= cells) {
    return;
  }

  // Get SDF values at 8 corners
  var corner_vals: array<f32, 8>;
  var corner_samples: array<vec3<u32>, 8>;
  var cube_index: u32 = 0u;

  for (var i: u32 = 0u; i < 8u; i = i + 1u) {
    let offset = CUBE_CORNERS[i];
    let sx = cx + offset.x;
    let sy = cy + offset.y;
    let sz = cz + offset.z;
    corner_samples[i] = vec3<u32>(sx, sy, sz);
    corner_vals[i] = get_sdf(sx, sy, sz);
    if (corner_vals[i] < uniforms.iso_level) {
      cube_index = cube_index | (1u << i);
    }
  }

  // Look up edge mask
  let edge_mask = edge_table[cube_index];
  if (edge_mask == 0u) {
    return; // No surface intersection
  }

  // Compute world positions of corners
  let origin = uniforms.chunk_origin;
  let vs = uniforms.voxel_size;
  var corner_pos: array<vec3<f32>, 8>;
  for (var i: u32 = 0u; i < 8u; i = i + 1u) {
    let s = corner_samples[i];
    corner_pos[i] = origin + vec3<f32>(f32(s.x), f32(s.y), f32(s.z)) * vs;
  }

  // Compute edge intersection vertices
  var edge_positions: array<vec3<f32>, 12>;
  var edge_normals: array<vec3<f32>, 12>;

  for (var e: u32 = 0u; e < 12u; e = e + 1u) {
    if ((edge_mask & (1u << e)) != 0u) {
      let a = EDGE_A[e];
      let b = EDGE_B[e];
      edge_positions[e] = interp_position(
        corner_pos[a], corner_pos[b],
        corner_vals[a], corner_vals[b]
      );
      edge_normals[e] = interp_normal(
        corner_samples[a], corner_samples[b],
        corner_vals[a], corner_vals[b]
      );
    }
  }

  // Generate triangles
  let tri_offset = cube_index * 16u;
  for (var t: u32 = 0u; t < 16u; t = t + 3u) {
    let e0 = tri_table[tri_offset + t];
    if (e0 == -1) {
      break;
    }
    let e1 = tri_table[tri_offset + t + 1u];
    let e2 = tri_table[tri_offset + t + 2u];

    // Atomic append 3 vertices
    let vert_idx = atomicAdd(&counter, 3u);
    let max_verts = arrayLength(&vertices) / 6u;
    if (vert_idx + 3u > max_verts) {
      break; // Buffer full — skip remaining triangles
    }
    let base = vert_idx * 6u; // 6 floats per vertex (pos + normal)

    // Vertex 0
    vertices[base + 0u] = edge_positions[e0].x;
    vertices[base + 1u] = edge_positions[e0].y;
    vertices[base + 2u] = edge_positions[e0].z;
    vertices[base + 3u] = edge_normals[e0].x;
    vertices[base + 4u] = edge_normals[e0].y;
    vertices[base + 5u] = edge_normals[e0].z;

    // Vertex 1
    vertices[base + 6u] = edge_positions[e1].x;
    vertices[base + 7u] = edge_positions[e1].y;
    vertices[base + 8u] = edge_positions[e1].z;
    vertices[base + 9u] = edge_normals[e1].x;
    vertices[base + 10u] = edge_normals[e1].y;
    vertices[base + 11u] = edge_normals[e1].z;

    // Vertex 2
    vertices[base + 12u] = edge_positions[e2].x;
    vertices[base + 13u] = edge_positions[e2].y;
    vertices[base + 14u] = edge_positions[e2].z;
    vertices[base + 15u] = edge_normals[e2].x;
    vertices[base + 16u] = edge_normals[e2].y;
    vertices[base + 17u] = edge_normals[e2].z;
  }
}
