// Build Padded Buffer Compute Shader
// Assembles a padded SDF buffer from center and neighbor chunk SDF buffers.
// The padded buffer has 1 extra sample on each face for seamless gradient computation
// in the subsequent marching cubes pass.
//
// Interior voxels copy directly from center chunk SDF.
// Single-face boundary voxels read from the corresponding neighbor chunk.
// Edge/corner voxels get emptyValue (no diagonal neighbor data needed).

struct BuildPaddedUniforms {
  samples_per_axis: u32,  // chunk samples (chunkSize + 1), e.g. 33
  empty_value: f32,       // SDF value for empty space (1.0)
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> uniforms: BuildPaddedUniforms;
@group(0) @binding(1) var<storage, read> center_sdf: array<f32>; // samples^3
@group(0) @binding(2) var<storage, read> nxm_sdf: array<f32>;
@group(0) @binding(3) var<storage, read> nxp_sdf: array<f32>;
@group(0) @binding(4) var<storage, read> nym_sdf: array<f32>;
@group(0) @binding(5) var<storage, read> nyp_sdf: array<f32>;
@group(0) @binding(6) var<storage, read> nzm_sdf: array<f32>;
@group(0) @binding(7) var<storage, read> nzp_sdf: array<f32>;
@group(0) @binding(8) var<storage, read_write> padded: array<f32>; // (samples+2)^3

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
  let cs = S - 1u;

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
    padded[out_idx] = center_sdf[iz * S * S + iy * S + ix];
  } else if (boundary_count == 1u) {
    let ix = px - 1u;
    let iy = py - 1u;
    let iz = pz - 1u;

    // Single-face boundary: read from neighbor chunk buffer
    if (on_xm) {
      padded[out_idx] = nxm_sdf[iz * S * S + iy * S + (cs - 1u)];
    } else if (on_xp) {
      padded[out_idx] = nxp_sdf[iz * S * S + iy * S + 1u];
    } else if (on_ym) {
      padded[out_idx] = nym_sdf[iz * S * S + (cs - 1u) * S + ix];
    } else if (on_yp) {
      padded[out_idx] = nyp_sdf[iz * S * S + 1u * S + ix];
    } else if (on_zm) {
      padded[out_idx] = nzm_sdf[(cs - 1u) * S * S + iy * S + ix];
    } else {
      // on_zp
      padded[out_idx] = nzp_sdf[1u * S * S + iy * S + ix];
    }
  } else {
    // Edge or corner: no diagonal neighbor data, fill with emptyValue
    padded[out_idx] = uniforms.empty_value;
  }
}
