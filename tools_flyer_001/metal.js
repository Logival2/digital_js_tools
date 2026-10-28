// ═══════════════════════════════════════════════════════════════════
// Plaque de métal — WebGL2, sans moteur 3D : l'affiche (texte blanc sur noir) devient un relief,
// puis ce relief est éclairé comme une plaque de métal vue de face.
//  1. graines : les pixels du bord des lettres, avec la position exacte du contour (au sous-pixel près,
//     d'après les bords adoucis du dessin des lettres) ;
//  2. inondation par sauts (jump flooding) : chaque pixel trouve le point du contour le plus proche → distance ;
//  3. hauteur : un profil arrondi sur la largeur du chanfrein (le métal embouti se courbe, il ne casse pas) ;
//  4. lissage infime, et plus large seulement pour les grands arrondis.
//  Le relief est calculé à 2 × la résolution de l'image : les arêtes restent nettes.
//  5. éclairage : la plaque est une photo de métal (dossier texture/), telle quelle à plat ; les arêtes
//     inclinées en reflètent une autre partie (filets clairs et sombres), puis reflet de la lampe, ombres portées.
//     Matière « laque » : des lettres en relief, rondes, en laque noire brillante posées sur un fond uni ;
//     le dessus reste sombre, les arrondis reflètent une boîte à lumière (filets blancs), ombre douce au pied.
//     Matière « peau » : pas de relief, un coup de soleil — les lettres rougies sur la photo de peau,
//     aux bords diffus, un peu marbrées, comme une peau brûlée à travers un pochoir.
// ═══════════════════════════════════════════════════════════════════

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// 1. graines : un pixel du bord (gris, ou voisin de l'autre côté), et le décalage jusqu'au contour (masque = 0,5)
//    le long de la pente du masque. On stocke des décalages relatifs : précis près du contour, là où ça compte.
const SEED = `#version 300 es
precision highp float;
uniform sampler2D uMask;
out vec4 o;
float M(ivec2 q, ivec2 s) { return texelFetch(uMask, clamp(q, ivec2(0), s - 1), 0).r; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 s = textureSize(uMask, 0);
  float m = M(p, s);
  float l = M(p + ivec2(-1, 0), s), r = M(p + ivec2(1, 0), s), d = M(p + ivec2(0, -1), s), u = M(p + ivec2(0, 1), s);
  bool inside = m > 0.5;
  bool edge = (m > 0.02 && m < 0.98) || (l > 0.5) != inside || (r > 0.5) != inside || (d > 0.5) != inside || (u > 0.5) != inside;
  if (!edge) { o = vec4(0.0); return; }
  vec2 g = vec2(r - l, u - d) * 0.5;
  float gn = length(g);
  vec2 off = gn > 1e-4 ? g / gn * clamp((0.5 - m) / gn, -1.0, 1.0) : vec2(0.0);
  o = vec4(off, 1.0, 0.0);
}`;

// 2. un pas de l'inondation : on garde la graine la plus proche parmi les 9 voisins à « uStep » pixels
const JFA = `#version 300 es
precision highp float;
uniform sampler2D uSeeds;
uniform int uStep;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 s = textureSize(uSeeds, 0);
  vec4 c0 = texelFetch(uSeeds, p, 0);
  vec2 best = c0.xy;
  float bd = c0.b > 0.5 ? length(best) : 1e9;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 q = p + ivec2(i, j) * uStep;
    if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, s))) continue;
    vec4 c = texelFetch(uSeeds, q, 0);
    if (c.b < 0.5) continue;
    vec2 off = vec2(q - p) + c.xy;               // du pixel jusqu'au point du contour trouvé par le voisin
    float d = length(off);
    if (d < bd) { bd = d; best = off; }
  }
  o = bd < 1e8 ? vec4(best, 1.0, 0.0) : vec4(0.0);
}`;

// 3. hauteur : 0 sur la plaque, 1 au sommet des lettres, profil en quart de cercle adouci
const HEIGHT = `#version 300 es
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uSeeds;
uniform float uWidth;   // largeur du chanfrein, en pixels de travail
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = texelFetch(uMask, p, 0).r;
  vec4 c = texelFetch(uSeeds, p, 0);
  float d = c.b > 0.5 ? length(c.xy) : 1e4;
  float sd = m > 0.5 ? d : -d;                 // distance signée au contour, positive dans les lettres
  float t = clamp(sd / uWidth, 0.0, 1.0);
  float round = sqrt(1.0 - (1.0 - t) * (1.0 - t));
  float h = mix(round, t * t * (3.0 - 2.0 * t), 0.35); // un peu de S : le pied du chanfrein se raccorde en douceur
  o = vec4(h, 0.0, 0.0, 1.0);
}`;

// 4. flou gaussien séparable (9 prises), pour des normales sans marches d'escalier
const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDir;      // (1, 0) puis (0, 1), en pixels
uniform float uRadius;
out vec4 o;
void main() {
  vec2 s = vec2(textureSize(uSrc, 0));
  vec2 uv = gl_FragCoord.xy / s;
  float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  float v = texture(uSrc, uv).r * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uDir * float(i) * uRadius / s;
    v += (texture(uSrc, uv + off).r + texture(uSrc, uv - off).r) * w[i];
  }
  o = vec4(v, 0.0, 0.0, 1.0);
}`;

// 4 bis. laque : le lissage fort n'est gardé que dans les traits larges ; les traits fins (petits textes)
// gardent le relief peu lissé, sinon leurs arrondis se fondent en une tache. Un trait est large quand la
// hauteur nette atteint presque son sommet dans un disque autour du point.
const COMBINE = `#version 300 es
precision highp float;
uniform sampler2D uSharp;
uniform sampler2D uSoft;
uniform float uR;       // rayon du disque, en pixels de travail
out vec4 o;
void main() {
  vec2 s = vec2(textureSize(uSharp, 0));
  vec2 uv = gl_FragCoord.xy / s;
  float peak = texture(uSharp, uv).r;
  for (int r = 1; r <= 2; r++) for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.3927 + float(r) * 0.2;
    peak = max(peak, texture(uSharp, uv + vec2(cos(a), sin(a)) * uR * float(r) * 0.5 / s).r);
  }
  float wide = smoothstep(0.55, 0.9, peak);
  o = vec4(mix(texture(uSharp, uv).r, texture(uSoft, uv).r, wide), 0.0, 0.0, 1.0);
}`;

// 5. éclairage : la plaque, c'est la photo du métal (texture/), recadrée pour couvrir l'affiche, avec sa lumière,
// son brossage et ses rayures. À plat, on voit la photo telle quelle ; une face inclinée en reflète une autre
// partie, adoucie comme sur un métal courbé, plus claire tournée vers la lampe, plus sombre à l'opposé
// (les filets des arêtes) ; puis le reflet de la lampe et l'ombre portée du relief.
const SHADE = `#version 300 es
precision highp float;
uniform sampler2D uH;
uniform sampler2D uPlate;   // la photo du métal (sRGB, avec ses mipmaps)
uniform vec2 uPlateSize;    // sa taille en px ; 0 tant qu'elle n'est pas chargée
uniform vec2 uRes;          // taille de sortie (px)
uniform vec2 uTex;          // taille du relief (px de travail)
uniform float uDepth;       // hauteur du relief, en px de travail (négative : défoncé)
uniform float uWidth;       // largeur du chanfrein, px de travail
uniform vec3 uLight;        // vers la lampe (x à droite, y vers le bas, z vers l'œil)
uniform float uShine;       // 0 satiné → 1 poli
uniform vec3 uTint;         // teinte, relative au gris neutre (1, 1, 1 : la photo telle quelle)
uniform int uMaterial;      // 0 métal, 1 peau, 2 laque
uniform float uRedness;     // peau : force de la rougeur
uniform vec3 uBg;           // laque : couleur du fond (linéaire)
uniform vec3 uInk;          // laque : couleur des lettres (linéaire)

// laque : le studio reflété — sombre droit devant, une grande boîte à lumière du côté de la lampe,
// une plus petite à l'opposé, un sol un peu clair (le fond qui se reflète au pied des lettres)
float studio(vec3 R, vec3 L, float shine) {
  vec3 Lf = normalize(vec3(-L.x, -L.y, L.z * 0.6));
  float key = smoothstep(mix(0.55, 0.86, shine), mix(0.80, 0.97, shine), dot(R, normalize(vec3(L.xy, L.z * 0.7))));
  float fill = smoothstep(0.80, 0.95, dot(R, Lf)) * 0.18;
  float ground = smoothstep(0.30, -0.10, R.z) * 0.04;
  return 0.004 + key * 2.6 + fill + ground;
}
out vec4 o;

float H(vec2 uv) { return texture(uH, uv).r * uDepth; }
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// la photo recadrée comme « cover » ; lod : flou des reflets sur les arrondis
vec2 cover(vec2 uv) {
  float a = uTex.x / uTex.y, b = uPlateSize.x / uPlateSize.y;
  return a < b ? vec2(0.5 + (uv.x - 0.5) * a / b, uv.y) : vec2(uv.x, 0.5 + (uv.y - 0.5) * b / a);
}
vec3 plate(vec2 uv, float lod) {
  if (uPlateSize.x < 1.0) return vec3(mix(0.55, 0.05, smoothstep(0.0, 1.0, uv.y)));   // en attendant la photo
  return pow(textureLod(uPlate, clamp(cover(uv), 0.0, 1.0), lod).rgb, vec3(2.2));
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes;
  vec2 tx = 1.0 / uTex;
  float hc = H(uv);
  float hx = H(uv + vec2(tx.x, 0.0)) - H(uv - vec2(tx.x, 0.0));
  float hy = H(uv + vec2(0.0, tx.y)) - H(uv - vec2(0.0, tx.y));
  vec3 N = normalize(vec3(-hx * 0.5, -hy * 0.5, 1.0));
  vec2 d = normalize(uLight.xy);
  float tilt = 1.0 - N.z;

  // reflet : à plat, la photo ; incliné, une autre partie de la photo, plus floue
  vec3 base = plate(uv, 0.0);
  vec3 refl = plate(uv + N.xy * vec2(uTex.y / uTex.x, 1.0) * 0.35, mix(4.5, 1.5, uShine));
  vec3 e = mix(base, refl, smoothstep(0.0, 0.25, tilt));
  e *= clamp(1.0 + dot(N.xy, d) * 2.8, 0.1, 3.0);

  // le reflet de la lampe, seulement sur les faces inclinées vers elle
  vec3 Hh = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, Hh), 0.0), mix(30.0, 420.0, uShine)) * mix(0.4, 1.8, uShine) * smoothstep(0.0, 0.2, tilt);

  // ombre portée du relief : on remonte vers la lampe ; si le relief passe au-dessus du rayon, elle est cachée
  vec3 L = uLight;
  float tanE = L.z / max(length(L.xy), 1e-3);
  vec2 dir = normalize(L.xy) * tx;
  float reach = abs(uDepth) / tanE * 1.2 + 2.0;
  float sh = 1.0;
  for (int i = 1; i <= 24; i++) {
    float dd = reach * float(i) / 24.0;
    float hs = H(uv + dir * dd);
    sh = min(sh, clamp(1.0 - (hs - (hc + dd * tanE)) / (abs(uDepth) * 0.15 + 0.3), 0.0, 1.0));
  }

  // un peu d'ombre au pied des parois
  float occ = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 off = vec2(cos(float(i) * 0.785398), sin(float(i) * 0.785398)) * uWidth * 0.7 * tx;
    occ += max(H(uv + off) - hc, 0.0);
  }
  float ao = 1.0 - clamp(occ / (8.0 * abs(uDepth) + 1e-3) * 1.2, 0.0, 0.22);

  if (uMaterial == 2) {
    float t = texture(uH, uv).r;                         // 0 sur le fond, 1 au sommet des lettres
    float letter = smoothstep(0.0, 0.06, t);
    // fond : uni, sans ombre portée
    vec3 bg = uBg;
    bg *= 1.0 - 0.10 * smoothstep(0.3, 0.9, length((uv - 0.5) * vec2(uTex.x / uTex.y, 1.0)));
    // laque : la couleur à peine, presque tout est reflet ; plus la surface penche, plus elle reflète
    vec3 R = reflect(vec3(0.0, 0.0, -1.0), N);
    float fres = 0.04 + 0.96 * pow(1.0 - N.z, 2.0);
    vec3 lac = uInk * 0.5 + vec3(studio(R, uLight, uShine)) * mix(0.03, 0.9, fres);
    lac += pow(max(dot(N, Hh), 0.0), mix(60.0, 600.0, uShine)) * 1.5;   // l'éclat de la lampe
    vec3 col = mix(bg, lac, letter);
    o = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    return;
  }

  if (uMaterial == 1) {
    // coup de soleil : la part de lettre dans un disque autour du point (bord diffus, comme une brûlure),
    // sans relief ni ombre ; une marbrure lente rend la rougeur inégale, plus vive au cœur des lettres
    // la lettre elle-même (même un trait fin compte entier), puis diffusée sur le disque
    #define INK(p) smoothstep(0.0, 0.12, texture(uH, p).r)
    float burn = INK(uv) * 2.0;
    for (int r = 1; r <= 3; r++) for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236 + float(r) * 0.26;
      burn += INK(uv + vec2(cos(a), sin(a)) * uWidth * 0.3 * float(r) * tx);
    }
    burn /= 38.0;
    vec2 q = uv * uTex / min(uTex.x, uTex.y);
    float blotch = 0.72 + 0.56 * (vnoise(q * 7.0) * 0.55 + vnoise(q * 23.0) * 0.3 + vnoise(q * 70.0) * 0.15);
    float red = clamp(smoothstep(0.05, 0.6, burn) * blotch, 0.0, 1.0) * uRedness * 1.5;
    vec3 skin = mix(base, base * vec3(1.45, 0.52, 0.60), clamp(red, 0.0, 1.0));   // rose brûlé : plus de rouge, moins de vert, un peu moins de bleu
    skin *= 1.0 - 0.08 * red;                                     // la peau brûlée fonce à peine
    o = vec4(pow(clamp(skin, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    return;
  }

  vec3 col = e * uTint * mix(0.62, 1.0, sh) * ao + mix(uTint, vec3(1.0), 0.6) * spec * sh;
  col = mix(col, 0.8 + (col - 0.8) / (1.0 + (col - 0.8) * 3.0), step(0.8, col));   // seuls les reflets très clairs se tassent
  o = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

export function createMetal(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null;
  gl.getExtension("OES_texture_float_linear");

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const program = (fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    return { p, u: (name) => (loc[name] ??= gl.getUniformLocation(p, name)) };
  };
  const P = { seed: program(SEED), jfa: program(JFA), height: program(HEIGHT), blur: program(BLUR), comb: program(COMBINE), shade: program(SHADE) };
  gl.bindVertexArray(gl.createVertexArray());

  const maskTex = gl.createTexture();
  // la photo du métal : un pixel gris en attendant qu'elle soit chargée
  const plateTex = gl.createTexture();
  let plateSize = [0, 0];
  gl.bindTexture(gl.TEXTURE_2D, plateTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
  // image : une photo décodée (img, canvas, bitmap). Lève une erreur si le navigateur refuse de la lire
  // (page ouverte comme fichier local : la photo compte alors comme venue d'ailleurs).
  function setPlate(image) {
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    plateSize = [image.naturalWidth || image.width, image.naturalHeight || image.height];
  }
  let size = [0, 0], targets = null;
  const target = (internal, format, filter) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, size[0], size[1], 0, format, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb };
  };
  const ensureTargets = (w, h) => {
    if (targets && size[0] === w && size[1] === h) return;
    if (targets) for (const t of Object.values(targets)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    size = [w, h];
    targets = {
      a: target(gl.RGBA16F, gl.RGBA, gl.NEAREST), b: target(gl.RGBA16F, gl.RGBA, gl.NEAREST),
      h1: target(gl.R16F, gl.RED, gl.LINEAR), h2: target(gl.R16F, gl.RED, gl.LINEAR), h3: target(gl.R16F, gl.RED, gl.LINEAR),
    };
  };
  const pass = (prog, fb, w, h, uniforms, textures) => {
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    textures.forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.u(name), i);
    });
    uniforms(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // mask : un canvas, texte blanc sur fond noir, à la taille de travail (2 × l'image, ≤ 4096 px de côté)
  // opts : material "metal" | "skin", relief "deboss" | "emboss", depth, softness, light (degrés), shine, redness,
  //        tint "#rrggbb" facultatif (#c8c8c8, par défaut = la photo telle quelle)
  function render(mask, opts) {
    const w = mask.width, h = mask.height;
    ensureTargets(w, h);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const short = Math.min(w, h);
    const width = short * (0.003 + opts.softness * 0.022);            // chanfrein : 0,3 % → 2,5 % du petit côté
    const depth = width * (0.15 + opts.depth * 1.35) * (opts.relief === "deboss" && opts.material !== "gloss" ? -1 : 1);

    pass(P.seed, targets.a.fb, w, h, () => {}, [["uMask", maskTex]]);
    let src = targets.a, dst = targets.b;
    for (let step = 2 ** Math.ceil(Math.log2(Math.max(w, h))) / 2; step >= 1; step /= 2) {
      pass(P.jfa, dst.fb, w, h, (u) => gl.uniform1i(u("uStep"), step), [["uSeeds", src.tex]]);
      [src, dst] = [dst, src];
    }
    pass(P.height, targets.h1.fb, w, h, (u) => gl.uniform1f(u("uWidth"), width), [["uMask", maskTex], ["uSeeds", src.tex]]);
    // lissage : un passage infime (σ ≈ 0,85 px de travail, soit moins d'un demi-pixel de l'image) efface le bruit
    // de l'inondation ; les grands arrondis ont en plus un flou à leur mesure, pour adoucir l'arête au milieu
    // des traits étroits (là où les deux pentes se rejoignent). Prises à 1 px au plus : plus espacées,
    // le métal brillant ferait voir une trame. Un passage à 1 px ≈ σ 1,7 px ; n passages ≈ σ 1,7 √n.
    const blur = (radius) => {
      pass(P.blur, targets.h2.fb, w, h, (u) => { gl.uniform2f(u("uDir"), 1, 0); gl.uniform1f(u("uRadius"), radius); }, [["uSrc", targets.h1.tex]]);
      pass(P.blur, targets.h1.fb, w, h, (u) => { gl.uniform2f(u("uDir"), 0, 1); gl.uniform1f(u("uRadius"), radius); }, [["uSrc", targets.h2.tex]]);
    };
    blur(0.5);
    const gloss = true;   // lissage adaptatif pour tous les rendus en relief
    if (gloss) pass(P.blur, targets.h3.fb, w, h, (u) => { gl.uniform2f(u("uDir"), 1, 0); gl.uniform1f(u("uRadius"), 0); }, [["uSrc", targets.h1.tex]]);
    const crease = width * 0.1;
    // laque : des arrondis très lisses (la normale ne doit pas montrer de facettes), donc plus de passages
    const passes = Math.min(24, 6 + Math.floor((crease / 1.7) ** 2) * 2);
    for (let k = 0; k < passes; k++) blur(1);
    if (gloss) {
      pass(P.comb, targets.h2.fb, w, h, (u) => gl.uniform1f(u("uR"), width * 0.6), [["uSharp", targets.h3.tex], ["uSoft", targets.h1.tex]]);
      pass(P.blur, targets.h1.fb, w, h, (u) => { gl.uniform2f(u("uDir"), 1, 0); gl.uniform1f(u("uRadius"), 0); }, [["uSrc", targets.h2.tex]]);
    }

    const a = (opts.light * Math.PI) / 180, elev = (35 * Math.PI) / 180;
    const L = [Math.cos(a) * Math.cos(elev), -Math.sin(a) * Math.cos(elev), Math.sin(elev)];
    const NEUTRAL = (0xc8 / 255) ** 2.2;
    const hex = opts.tint ?? "#c8c8c8";
    const tint = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2 / NEUTRAL);
    pass(P.shade, null, canvas.width, canvas.height, (u) => {
      gl.uniform2f(u("uRes"), canvas.width, canvas.height);
      gl.uniform2f(u("uTex"), w, h);
      gl.uniform1f(u("uDepth"), depth);
      gl.uniform1f(u("uWidth"), width);
      gl.uniform3f(u("uLight"), ...L);
      gl.uniform1f(u("uShine"), opts.shine);
      gl.uniform3f(u("uTint"), ...tint);
      gl.uniform1i(u("uMaterial"), { skin: 1, gloss: 2 }[opts.material] ?? 0);
      const lin = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2);
      gl.uniform3f(u("uBg"), ...lin(opts.bg ?? "#c0c2bb"));
      gl.uniform3f(u("uInk"), ...lin(opts.ink ?? "#000000"));
      gl.uniform1f(u("uRedness"), opts.redness ?? 0);
      gl.uniform2f(u("uPlateSize"), ...plateSize);
    }, [["uH", targets.h1.tex], ["uPlate", plateTex]]);
  }
  return { render, setPlate };
}
