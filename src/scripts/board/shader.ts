/** GLSL for the background board. WebGL1 / GLSL ES 1.00. */

import { BOARD_PITCH, BOARD_RADIUS, BOARD_SLOT } from "./math";

export const MAX_RIPPLES = 6;

export const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// All geometry is in CSS px, y up (GL convention). u_scale converts device px to CSS px.
export const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define MAX_RIPPLES ${MAX_RIPPLES}

uniform vec2 u_size;      // viewport, CSS px
uniform float u_scale;    // device px per CSS px
uniform vec2 u_pointer;   // CSS px, y up
uniform float u_prox;     // 0..1 proximity strength
uniform float u_drag;     // 0..1 dragging factor
uniform float u_progress; // 0..1 share of words found
uniform vec4 u_ripples[MAX_RIPPLES]; // x, y (CSS px, y up), age (s), amplitude (0 = inactive)

uniform vec3 u_bg;
uniform vec3 u_line;
uniform vec3 u_stripe;
uniform vec3 u_hover;
uniform vec3 u_violet;

const float PITCH = ${BOARD_PITCH.toFixed(1)};
const float HALF_SLOT = ${(BOARD_SLOT / 2).toFixed(1)};
const float RADIUS = ${BOARD_RADIUS.toFixed(1)};
const float OUTLINE = 1.0;
const float PROX_RADIUS = 160.0;
const float RING_SPEED = 900.0;
const float RING_WIDTH = 36.0;
const float RING_DISPLACE = 4.0;

float sdRoundRect(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = gl_FragCoord.xy / u_scale;
  vec2 center = u_size * 0.5;
  float aa = 1.0 / u_scale;

  vec2 disp = vec2(0.0);
  float ring = 0.0;
  for (int i = 0; i < MAX_RIPPLES; i++) {
    vec4 r = u_ripples[i];
    if (r.w <= 0.0) continue;
    vec2 d = p - r.xy;
    float dist = length(d);
    float x = (dist - r.z * RING_SPEED) / RING_WIDTH;
    float band = exp(-x * x) * r.w;
    disp += (dist > 0.001 ? d / dist : vec2(0.0)) * band * RING_DISPLACE;
    ring += band;
  }

  // One cell center sits on the viewport center.
  vec2 g = p - disp - center;
  vec2 cell = floor(g / PITCH + 0.5);
  vec2 local = g - cell * PITCH;
  vec2 cellCenter = center + cell * PITCH;

  float d = sdRoundRect(local, vec2(HALF_SLOT), RADIUS);
  float inside = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, d);
  float outline = inside * smoothstep(-OUTLINE - aa, -OUTLINE, d);

  // 135deg CSS stripes (y down) become x - y in y-up space. Period 8: 6 clear, 2 stripe.
  float t = (local.x - local.y) * 0.70710678;
  float sd = abs(mod(t - 3.0, 8.0) - 4.0); // distance to stripe center
  float stripe = 1.0 - smoothstep(1.0 - aa * 0.5, 1.0 + aa * 0.5, sd);

  vec2 v = (p - center) / max(center, vec2(1.0));
  float vig = 1.0 - smoothstep(0.15, 1.05, length(v * vec2(1.0, 0.85)));
  vig *= 0.62;

  float near = 1.0 - smoothstep(0.0, PROX_RADIUS, length(cellCenter - u_pointer));
  float prox = u_prox * near * near;

  vec3 col = u_bg;
  col = mix(col, u_stripe, stripe * inside * 0.55 * vig);

  // Progress: each slot lights up once u_progress passes its key. Keys grow with distance
  // from the centre, jittered per slot, so the lit area spreads outward irregularly.
  float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  float dn = length((cellCenter - center) / max(center, vec2(1.0))) / 1.42;
  float key = mix(dn, h, 0.45);
  float lit = smoothstep(key - 0.02, key + 0.02, u_progress * 1.05);

  float ringA = min(ring, 1.0);
  vec3 hi = mix(u_hover, u_violet, u_drag);
  vec3 lineCol = mix(u_line, hi, clamp(prox + ringA * 0.6, 0.0, 1.0));
  float lineA = clamp(0.35 * vig + prox * 0.6 + ringA * 0.6 * (0.5 + 0.5 * vig), 0.0, 1.0);
  col = mix(col, lineCol, outline * lineA);
  // Lit slots: a violet outline over the neutral one. Kept dim so the hero stays readable.
  float litA = lit * (0.06 + 0.3 * vig);
  col = mix(col, mix(u_line, u_violet, 0.85), outline * litA * (1.0 - prox * 0.5));

  gl_FragColor = vec4(col, 1.0);
}
`;
