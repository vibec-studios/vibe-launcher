pub struct Shape {
    pub rows: usize,
    pub inputs: usize,
    pub outputs: usize,
}

#[inline(always)]
fn init(out: &mut [f32], bias: Option<&[f32]>) {
    match bias {
        Some(b) => out.copy_from_slice(b),
        None => out.fill(0.0),
    }
}

#[inline(always)]
fn row_tail(x: &[f32], wt: &[f32], m: usize, bias: Option<&[f32]>, out: &mut [f32], from: usize) {
    init(&mut out[from..], bias.map(|b| &b[from..]));
    for (i, &xi) in x.iter().enumerate() {
        for (t, v) in out[from..].iter_mut().zip(&wt[i * m + from..(i + 1) * m]) {
            *t += xi * v;
        }
    }
}

#[inline(always)]
fn tile<const C: usize>(x: &[f32], n: usize, wt: &[f32], m: usize, bias: Option<&[f32]>, out: &mut [f32], c: usize) {
    let start: [f32; C] = match bias {
        Some(b) => b[c..c + C].try_into().unwrap(),
        None => [0.0; C],
    };
    let mut acc = [start; 4];
    for i in 0..n {
        let w: &[f32; C] = wt[i * m + c..i * m + c + C].try_into().unwrap();
        for (r, a) in acc.iter_mut().enumerate() {
            let xr = x[r * n + i];
            for k in 0..C {
                a[k] += xr * w[k];
            }
        }
    }
    for (r, a) in acc.iter().enumerate() {
        out[r * m + c..r * m + c + C].copy_from_slice(a);
    }
}

#[inline(always)]
pub fn portable(x: &[f32], wt: &[f32], bias: Option<&[f32]>, out: &mut [f32], s: &Shape) {
    let (n, m) = (s.inputs, s.outputs);
    let (eight, four) = (m / 8 * 8, m / 4 * 4);
    let blocks = s.rows / 4;
    for b in 0..blocks {
        let xs = &x[b * 4 * n..(b + 1) * 4 * n];
        let os = &mut out[b * 4 * m..(b + 1) * 4 * m];
        for c in (0..eight).step_by(8) {
            tile::<8>(xs, n, wt, m, bias, os, c);
        }
        if four > eight {
            tile::<4>(xs, n, wt, m, bias, os, eight);
        }
        if four < m {
            for (row, target) in xs.chunks_exact(n).zip(os.chunks_exact_mut(m)) {
                row_tail(row, wt, m, bias, target, four);
            }
        }
    }
    for row in blocks * 4..s.rows {
        row_tail(&x[row * n..(row + 1) * n], wt, m, bias, &mut out[row * m..(row + 1) * m], 0);
    }
}

pub fn simd_enabled() -> bool {
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ENABLED.get_or_init(|| {
        let allowed = std::env::var_os("VIBEFIX_NO_SIMD").is_none();
        #[cfg(target_arch = "x86_64")]
        return allowed && std::is_x86_feature_detected!("avx2") && std::is_x86_feature_detected!("fma");
        #[cfg(not(target_arch = "x86_64"))]
        return false && allowed;
    })
}

pub fn gemm(x: &[f32], wt: &[f32], bias: Option<&[f32]>, out: &mut [f32], s: &Shape) {
    #[cfg(target_arch = "x86_64")]
    if simd_enabled() {
        return unsafe { avx::gemm(x, wt, bias, out, s) };
    }
    portable(x, wt, bias, out, s)
}

#[cfg(target_arch = "x86_64")]
mod avx {
    use std::arch::x86_64::*;

    use super::{row_tail, Shape};

    #[target_feature(enable = "avx2,fma")]
    unsafe fn tile16(x: *const f32, n: usize, wt: *const f32, m: usize, bias: Option<&[f32]>, out: *mut f32, c: usize) {
        let (b0, b1) = match bias {
            Some(b) => (_mm256_loadu_ps(b.as_ptr().add(c)), _mm256_loadu_ps(b.as_ptr().add(c + 8))),
            None => (_mm256_setzero_ps(), _mm256_setzero_ps()),
        };
        let mut acc = [b0, b1, b0, b1, b0, b1, b0, b1];
        for i in 0..n {
            let w0 = _mm256_loadu_ps(wt.add(i * m + c));
            let w1 = _mm256_loadu_ps(wt.add(i * m + c + 8));
            for r in 0..4 {
                let xr = _mm256_set1_ps(*x.add(r * n + i));
                acc[2 * r] = _mm256_fmadd_ps(xr, w0, acc[2 * r]);
                acc[2 * r + 1] = _mm256_fmadd_ps(xr, w1, acc[2 * r + 1]);
            }
        }
        for r in 0..4 {
            _mm256_storeu_ps(out.add(r * m + c), acc[2 * r]);
            _mm256_storeu_ps(out.add(r * m + c + 8), acc[2 * r + 1]);
        }
    }

    #[target_feature(enable = "avx2,fma")]
    unsafe fn tile8(x: *const f32, n: usize, wt: *const f32, m: usize, bias: Option<&[f32]>, out: *mut f32, c: usize) {
        let b = match bias {
            Some(b) => _mm256_loadu_ps(b.as_ptr().add(c)),
            None => _mm256_setzero_ps(),
        };
        let mut acc = [b; 4];
        for i in 0..n {
            let w = _mm256_loadu_ps(wt.add(i * m + c));
            for (r, a) in acc.iter_mut().enumerate() {
                *a = _mm256_fmadd_ps(_mm256_set1_ps(*x.add(r * n + i)), w, *a);
            }
        }
        for (r, a) in acc.iter().enumerate() {
            _mm256_storeu_ps(out.add(r * m + c), *a);
        }
    }

    #[target_feature(enable = "avx2,fma")]
    unsafe fn tile4(x: *const f32, n: usize, wt: *const f32, m: usize, bias: Option<&[f32]>, out: *mut f32, c: usize) {
        let b = match bias {
            Some(b) => _mm_loadu_ps(b.as_ptr().add(c)),
            None => _mm_setzero_ps(),
        };
        let mut acc = [b; 4];
        for i in 0..n {
            let w = _mm_loadu_ps(wt.add(i * m + c));
            for (r, a) in acc.iter_mut().enumerate() {
                *a = _mm_fmadd_ps(_mm_set1_ps(*x.add(r * n + i)), w, *a);
            }
        }
        for (r, a) in acc.iter().enumerate() {
            _mm_storeu_ps(out.add(r * m + c), *a);
        }
    }

    #[target_feature(enable = "avx2,fma")]
    pub unsafe fn gemm(x: &[f32], wt: &[f32], bias: Option<&[f32]>, out: &mut [f32], s: &Shape) {
        let (n, m) = (s.inputs, s.outputs);
        assert!(x.len() >= s.rows * n && out.len() >= s.rows * m && wt.len() >= n * m);
        let wide = m / 16 * 16;
        let narrow = m / 8 * 8;
        let small = m / 4 * 4;
        let blocks = s.rows / 4;
        for b in 0..blocks {
            let xp = x.as_ptr().add(b * 4 * n);
            let op = out.as_mut_ptr().add(b * 4 * m);
            for c in (0..wide).step_by(16) {
                tile16(xp, n, wt.as_ptr(), m, bias, op, c);
            }
            if narrow > wide {
                tile8(xp, n, wt.as_ptr(), m, bias, op, wide);
            }
            if small > narrow {
                tile4(xp, n, wt.as_ptr(), m, bias, op, narrow);
            }
            if small < m {
                for r in 0..4 {
                    let row = b * 4 + r;
                    row_tail(&x[row * n..(row + 1) * n], wt, m, bias, &mut out[row * m..(row + 1) * m], small);
                }
            }
        }
        for row in blocks * 4..s.rows {
            row_tail(&x[row * n..(row + 1) * n], wt, m, bias, &mut out[row * m..(row + 1) * m], 0);
        }
    }
}
