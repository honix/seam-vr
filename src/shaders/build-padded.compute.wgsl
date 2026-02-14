// Build Padded Buffer Compute Shader
// Assembles a padded SDF buffer from a chunk's SDF data and 6 neighbor boundary slices.
// The padded buffer has 1 extra sample on each face for seamless gradient computation
// in the subsequent marching cubes pass.
//
// Interior voxels copy directly from chunk SDF.
// Face boundary voxels read from packed neighbor slices.
// Edge/corner voxels get emptyValue (no diagonal neighbor data needed).

struct BuildPaddedUniforms {
  samples_per_axis: u32,  // chunk samples (chunkSize + 1), e.g. 33
  empty_value: f32,       // SDF value for empty space (1.0)
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> uniforms: BuildPaddedUniforms;
@group(0) @binding(1) var<storage, read> chunk_sdf: array<f32>;       // samples^3
@group(0) @binding(2) var<storage, read> neighbor_slices: array<f32>; // 6 * samples^2
@group(0) @binding(3) var<storage, read_write> padded: array<f32>;    // (samples+2)^3

// Slice packing layout (each face = samples^2 floats):
//   offset 0*S^2: -X face (neighbor's ix=cs-1), indexed [iz * S + iy]
//   offset 1*S^2: +X face (neighbor's ix=1),    indexed [iz * S + iy]
//   offset 2*S^2: -Y face (neighbor's iy=cs-1), indexed [iz * S + ix]
//   offset 3*S^2: +Y face (neighbor's iy=1),    indexed [iz * S + ix]
//   offset 4*S^2: -Z face (neighbor's iz=cs-1), indexed [iy * S + ix]
//   offset 5*S^2: +Z face (neighbor's iz=1),    indexed [iy * S + ix]

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let S = uniforms.samples_per_axis;
  let P = S + 2u;

  let px = global_id.x;
  let py = global_id.y;
  let pz = global_id.z;

  if (px >= P || py >= P || pz >= P) {
    return;
  }

  let out_idx = pz * P * P + py * P + px;
  let S2 = S * S;

  let on_xm = px == 0u;
  let on_xp = px == P - 1u;
  let on_ym = py == 0u;
  let on_yp = py == P - 1u;
  let on_zm = pz == 0u;
  let on_zp = pz == P - 1u;

  let boundary_count = u32(on_xm) + u32(on_xp) + u32(on_ym) + u32(on_yp) + u32(on_zm) + u32(on_zp);

  if (boundary_count == 0u) {
    // Interior: copy from chunk SDF
    let ix = px - 1u;
    let iy = py - 1u;
    let iz = pz - 1u;
    padded[out_idx] = chunk_sdf[iz * S * S + iy * S + ix];
  } else if (boundary_count == 1u) {
    // Single-face boundary: read from neighbor slice
    if (on_xm) {
      padded[out_idx] = neighbor_slices[0u * S2 + (pz - 1u) * S + (py - 1u)];
    } else if (on_xp) {
      padded[out_idx] = neighbor_slices[1u * S2 + (pz - 1u) * S + (py - 1u)];
    } else if (on_ym) {
      padded[out_idx] = neighbor_slices[2u * S2 + (pz - 1u) * S + (px - 1u)];
    } else if (on_yp) {
      padded[out_idx] = neighbor_slices[3u * S2 + (pz - 1u) * S + (px - 1u)];
    } else if (on_zm) {
      padded[out_idx] = neighbor_slices[4u * S2 + (py - 1u) * S + (px - 1u)];
    } else {
      // on_zp
      padded[out_idx] = neighbor_slices[5u * S2 + (py - 1u) * S + (px - 1u)];
    }
  } else {
    // Edge or corner: no diagonal neighbor data, fill with emptyValue
    padded[out_idx] = uniforms.empty_value;
  }
}
