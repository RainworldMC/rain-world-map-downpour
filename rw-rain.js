const RW_RAIN_TICKS_PER_SECOND = 40;
const RW_RAIN_SCREEN_WIDTH = 1366;
const RW_RAIN_SCREEN_HEIGHT = 768;
const RW_RAIN_DROP_COUNT = 500;
const RW_RAIN_MIN_DROPS = 100;
const RW_RAIN_MAX_DROPS = 1500;
const RW_RAIN_FLASH_SCALE = 0.7;
const RW_RAIN_NOISE_URL = 'resources/menu/noise2.png';
const RW_RAIN_FLOATS_PER_VERTEX = 9;

/**
 * Limits a number to the range 0 to 1.
 * @param {number} value The input number.
 * @returns {number} The limited number.
 */
function rwRainClamp01(value) {
    return Math.min(1, Math.max(0, value));
}

/**
 * Interpolates between two numbers. The amount is limited to 0 to 1, as in Unity Mathf.Lerp.
 * @param {number} from The start number.
 * @param {number} to The end number.
 * @param {number} amount The amount.
 * @returns {number} The result.
 */
function rwRainLerp(from, to, amount) {
    return from + (to - from) * rwRainClamp01(amount);
}

/**
 * Finds where a value is between two numbers, as in Unity Mathf.InverseLerp.
 * @param {number} from The start number.
 * @param {number} to The end number.
 * @param {number} value The value.
 * @returns {number} The amount from 0 to 1.
 */
function rwRainInverseLerp(from, to, value) {
    if (from === to) {
        return 0;
    }
    return rwRainClamp01((value - from) / (to - from));
}

/**
 * Moves a number toward a target with a lerp step and a fixed step, as in Custom.LerpAndTick.
 * @param {number} from The start number.
 * @param {number} to The target number.
 * @param {number} lerp The lerp amount.
 * @param {number} tick The fixed step.
 * @returns {number} The result.
 */
function rwRainLerpAndTick(from, to, lerp, tick) {
    let result = rwRainLerp(from, to, lerp);
    if (result < to) {
        result = Math.min(result + tick, to);
    } else {
        result = Math.max(result - tick, to);
    }
    return result;
}

/**
 * Maps a value from one range to another with an exponent, as in Custom.LerpMap.
 * @param {number} value The value.
 * @param {number} fromA The start of the input range.
 * @param {number} toA The end of the input range.
 * @param {number} fromB The start of the output range.
 * @param {number} toB The end of the output range.
 * @param {number} exponent The exponent.
 * @returns {number} The result.
 */
function rwRainLerpMap(value, fromA, toA, fromB, toB, exponent) {
    return fromB + (toB - fromB) * Math.pow(rwRainInverseLerp(fromA, toA, value), exponent);
}

/**
 * Makes a vector with a random direction.
 * @param {number} length The length of the vector.
 * @returns {number[]} The vector as x and y.
 */
function rwRainRandomVector(length) {
    const angle = Math.random() * Math.PI * 2;
    return [Math.sin(angle) * length, Math.cos(angle) * length];
}

/**
 * Limits the length of a vector.
 * @param {number[]} vector The vector as x and y.
 * @param {number} max The maximum length.
 * @returns {number[]} The limited vector.
 */
function rwRainClampMagnitude(vector, max) {
    const length = Math.hypot(vector[0], vector[1]);
    if (length <= max) {
        return vector;
    }
    return [vector[0] / length * max, vector[1] / length * max];
}

/**
 * Uploads the noise image to texture unit 0. The image repeats at the edges, as in the game.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {HTMLImageElement} image The noise image. The sides must be a power of two.
 * @returns {WebGLTexture} The texture.
 */
function rwRainCreateNoiseTexture(gl, image) {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return texture;
}

/**
 * Creates and links the rain shader program.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @returns {WebGLProgram} The linked program.
 */
function rwRainCreateProgram(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, rwTitleCompile(gl, gl.VERTEX_SHADER, rwTitleGetSource('rw-rain-vs')));
    gl.attachShader(program, rwTitleCompile(gl, gl.FRAGMENT_SHADER, rwTitleGetSource('rw-rain-fs')));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
}

/**
 * Creates the vertex buffer and sets the vertex layout.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {WebGLProgram} program The shader program.
 * @param {number} floatCount The number of floats in the buffer.
 */
function rwRainCreateBuffer(gl, program, floatCount) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, floatCount * 4, gl.DYNAMIC_DRAW);
    const stride = RW_RAIN_FLOATS_PER_VERTEX * 4;
    const layout = [['a_position', 2, 0], ['a_uv', 2, 8], ['a_color', 4, 16], ['a_mode', 1, 32]];
    for (const item of layout) {
        const location = gl.getAttribLocation(program, item[0]);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, item[1], gl.FLOAT, false, stride, item[2]);
    }
}

/**
 * Makes one rain drop. The start values are the same as in the game code.
 * @param {object} state The rain state.
 * @returns {object} The drop.
 */
function rwRainCreateDrop(state) {
    const drop = { x: 0, y: 0, lastX: 0, lastY: 0, lastLastX: 0, lastLastY: 0, depth: 1 };
    rwRainResetDrop(state, drop);
    drop.x = state.width * Math.random();
    drop.y = 900 * Math.random();
    drop.lastX = drop.x;
    drop.lastY = drop.y + 300 / drop.depth;
    drop.lastLastX = drop.lastX;
    drop.lastLastY = drop.lastY + 300 / drop.depth;
    return drop;
}

/**
 * Puts a drop back above the top edge of the screen.
 * @param {object} state The rain state.
 * @param {object} drop The drop.
 */
function rwRainResetDrop(state, drop) {
    drop.x = rwRainLerp(-100, state.width + 100, Math.random());
    drop.y = 770 + Math.random() * 100;
    drop.lastX = drop.x;
    drop.lastY = drop.y;
    drop.lastLastX = drop.x;
    drop.lastLastY = drop.y;
    drop.depth = rwRainLerp(0.5, 7, Math.pow(Math.random(), 0.5));
}

/**
 * Gives the fall direction for a depth value, as in RainEffect.RainDir.
 * @param {object} state The rain state.
 * @param {number} depthAmount The depth from 0 to 1.
 * @returns {number[]} The direction as x and y.
 */
function rwRainRainDirection(state, depthAmount) {
    const near = state.rainDirs[0][0];
    const far = state.rainDirs[1][0];
    return [rwRainLerp(near[0], far[0], depthAmount), -300 + rwRainLerp(near[1], far[1], depthAmount)];
}

/**
 * Moves one drop for one tick.
 * @param {object} state The rain state.
 * @param {object} drop The drop.
 */
function rwRainTickDrop(state, drop) {
    drop.lastLastX = drop.lastX;
    drop.lastLastY = drop.lastY;
    drop.lastX = drop.x;
    drop.lastY = drop.y;
    const direction = rwRainRainDirection(state, rwRainInverseLerp(0.5, 7, drop.depth));
    const jitter = rwRainRandomVector(Math.random() * 14);
    drop.x += (direction[0] + jitter[0]) / drop.depth;
    drop.y += (direction[1] + jitter[1]) / drop.depth;
    if (drop.lastY < 0) {
        rwRainResetDrop(state, drop);
    }
}

/**
 * Changes the two wind directions for one tick.
 * @param {object} state The rain state.
 */
function rwRainTickRainDirections(state) {
    for (let j = 0; j < 2; j++) {
        const kick = rwRainRandomVector(Math.pow(Math.random(), 3) * 5);
        const old = state.rainDirs[j];
        const position = rwRainClampMagnitude([old[0][0] + kick[0] + old[1][0], old[0][1] + kick[1] + old[1][1]], 30);
        const push = rwRainRandomVector(Math.pow(Math.random(), 15) * 5);
        const speed = rwRainClampMagnitude([old[1][0] * 0.9 - position[0] * 0.04 + push[0], old[1][1] * 0.9 - position[1] * 0.04 + push[1]], 10);
        state.rainDirs[j] = [position, speed];
    }
}

/**
 * Starts a lightning flash, as in RainEffect.LightningSpike.
 * @param {object} state The rain state.
 * @param {number} intensity The new intensity.
 * @param {number} dropOffFrames The number of ticks the flash takes to fade.
 */
function rwRainSpike(state, intensity, dropOffFrames) {
    state.lightningIntensity = Math.max(state.lightningIntensity, intensity);
    state.extraLightningChance = 1;
    state.dropOff = dropOffFrames;
}

/**
 * Runs one game tick of the rain and the lightning.
 * @param {object} state The rain state.
 */
function rwRainTick(state) {
    state.lastLightning = state.lightning;
    for (const drop of state.drops) {
        rwRainTickDrop(state, drop);
    }
    rwRainTickRainDirections(state);
    state.highlightPos -= 40;
    if (state.highlightPos < -500) {
        state.highlightPos = rwRainLerp(1000, 3000, Math.random());
    }
    state.lightning = rwRainLerpAndTick(state.lightning, 0, 0.06, 1 / rwRainLerp(8, 14, state.lightningIntensity));
    if (Math.random() < state.lightningIntensity * rwRainLerp(1, 2, state.extraLightningChance)) {
        state.lightning = Math.max(state.lightning, Math.random() * state.lightningIntensity);
    }
    if (state.dropOff > 0) {
        state.lightningIntensity = Math.max(0, state.lightningIntensity - 1 / state.dropOff);
    }
    state.extraLightningChance = Math.max(0, state.extraLightningChance - 0.1);
    if (Math.random() < 0.00625) {
        rwRainSpike(state, Math.pow(Math.random(), 2) * 0.85, rwRainLerp(20, 120, Math.random()));
    }
}

/**
 * Writes one vertex to the vertex array.
 * @param {object} state The rain state.
 * @param {number[]} values The nine vertex values: x, y, u, v, red, green, blue, alpha and mode.
 */
function rwRainPushVertex(state, values) {
    state.vertices.set(values, state.cursor);
    state.cursor += RW_RAIN_FLOATS_PER_VERTEX;
}

/**
 * Writes a rectangle that has its center at a point.
 * @param {object} state The rain state.
 * @param {number[]} box The center x, center y, width and height.
 * @param {number[]} color The red, green, blue and alpha values.
 * @param {number} mode The shader mode.
 */
function rwRainPushRect(state, box, color, mode) {
    const left = box[0] - box[2] / 2;
    const right = box[0] + box[2] / 2;
    const bottom = box[1] - box[3] / 2;
    const top = box[1] + box[3] / 2;
    rwRainPushVertex(state, [left, bottom, 0, 0, color[0], color[1], color[2], color[3], mode]);
    rwRainPushVertex(state, [right, bottom, 1, 0, color[0], color[1], color[2], color[3], mode]);
    rwRainPushVertex(state, [left, top, 0, 1, color[0], color[1], color[2], color[3], mode]);
    rwRainPushVertex(state, [right, bottom, 1, 0, color[0], color[1], color[2], color[3], mode]);
    rwRainPushVertex(state, [right, top, 1, 1, color[0], color[1], color[2], color[3], mode]);
    rwRainPushVertex(state, [left, top, 0, 1, color[0], color[1], color[2], color[3], mode]);
}

/**
 * Writes one rain streak as a thin rectangle.
 * @param {object} state The rain state.
 * @param {number[]} line The start x, start y, end x and end y.
 * @param {number} width The width of the streak.
 * @param {number} alpha The alpha of the streak.
 */
function rwRainPushLine(state, line, width, alpha) {
    const dx = line[2] - line[0];
    const dy = line[3] - line[1];
    const length = Math.hypot(dx, dy);
    if (length < 0.0001) {
        return;
    }
    const nx = -dy / length * width / 2;
    const ny = dx / length * width / 2;
    const a = [line[0] + nx, line[1] + ny, 0, 0, 1, 1, 1, alpha, 0];
    const b = [line[0] - nx, line[1] - ny, 0, 0, 1, 1, 1, alpha, 0];
    const c = [line[2] + nx, line[3] + ny, 0, 0, 1, 1, 1, alpha, 0];
    const d = [line[2] - nx, line[3] - ny, 0, 0, 1, 1, 1, alpha, 0];
    rwRainPushVertex(state, a);
    rwRainPushVertex(state, b);
    rwRainPushVertex(state, c);
    rwRainPushVertex(state, b);
    rwRainPushVertex(state, d);
    rwRainPushVertex(state, c);
}

/**
 * Writes all drops with the alpha and size rules of RainEffect.GrafUpdate.
 * @param {object} state The rain state.
 * @param {number} flash The flash amount.
 * @param {number} rainAmount The rain amount.
 */
function rwRainPushDrops(state, flash, rainAmount) {
    for (const drop of state.drops) {
        const highlight = Math.pow(rwRainInverseLerp(2000, 50, Math.abs(drop.y + drop.x * 0.23 - state.highlightPos)), 14);
        const boost = Math.max(highlight, flash);
        const vx = rwRainLerp(drop.lastX, drop.lastLastX, 0.2);
        const vy = rwRainLerp(drop.lastY, drop.lastLastY, 0.2);
        const width = Math.max(2.2 / rwRainLerp(drop.depth, 1, 0.7), state.pixelSize);
        const depthAlpha = rwRainLerpMap(drop.depth, 0.5, 7, 1, 0.1, rwRainLerp(1, 0.5, boost));
        const alpha = depthAlpha * rwRainLerp(0.3 * rainAmount, 0.8 * rainAmount + 0.2 * flash, boost);
        rwRainPushLine(state, [drop.x, drop.y, vx, vy], width, alpha);
    }
}

/**
 * Builds the vertices of one frame and draws them.
 * @param {object} state The rain state.
 * @param {number} timeStacker The amount between the last tick and the next tick.
 */
function rwRainDraw(state, timeStacker) {
    const gl = state.gl;
    const flash = Math.pow(Math.max(0, rwRainLerp(state.lastLightning, state.lightning, timeStacker)), 1.5) * RW_RAIN_FLASH_SCALE;
    const rainAmount = 1;
    const centerX = state.width / 2;
    const centerY = RW_RAIN_SCREEN_HEIGHT / 2;
    const widthScale = Math.max(1, state.width / RW_RAIN_SCREEN_WIDTH);
    state.cursor = 0;
    rwRainPushRect(state, [centerX, centerY, state.width + 8, RW_RAIN_SCREEN_HEIGHT + 8], [1, 1, 1, Math.pow(flash, 1.1) * 0.5], 0);
    rwRainPushRect(state, [800 + (state.width - RW_RAIN_SCREEN_WIDTH) / 2, 600, 1200, 1100], [1, 1, 1, Math.pow(flash, 0.9) * 0.5], 1);
    rwRainPushDrops(state, flash, rainAmount);
    rwRainPushRect(state, [centerX, centerY, rwRainLerp(1600, 2100, flash) * widthScale, rwRainLerp(1300, 1800, flash)], [0, 0, 0, rwRainLerp(0.37, 0.17, flash)], 2);
    gl.viewport(0, 0, state.canvas.width, state.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(state.viewUniform, state.width, RW_RAIN_SCREEN_HEIGHT);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.vertices.subarray(0, state.cursor));
    gl.drawArrays(gl.TRIANGLES, 0, state.cursor / RW_RAIN_FLOATS_PER_VERTEX);
}

/**
 * Matches the canvas size to the window and keeps the drop count correct for the screen width.
 * @param {object} state The rain state.
 */
function rwRainResize(state) {
    const canvas = state.canvas;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const width = Math.round(cssWidth * ratio);
    const height = Math.round(cssHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const scale = cssHeight / RW_RAIN_SCREEN_HEIGHT;
    state.width = cssWidth / scale;
    state.pixelSize = 1 / (scale * ratio);
    const wanted = Math.min(RW_RAIN_MAX_DROPS, Math.max(RW_RAIN_MIN_DROPS, Math.round(RW_RAIN_DROP_COUNT * state.width / RW_RAIN_SCREEN_WIDTH)));
    while (state.drops.length < wanted) {
        state.drops.push(rwRainCreateDrop(state));
    }
    state.drops.length = wanted;
}

/**
 * Runs one animation frame of the rain.
 * @param {object} state The rain state.
 * @param {number} now The frame time in milliseconds.
 */
function rwRainFrame(state, now) {
    if (!state.running) return;
    const delta = Math.min(0.1, (now - state.lastNow) / 1000);
    state.lastNow = now;
    rwRainResize(state);
    state.stacker += delta * RW_RAIN_TICKS_PER_SECOND;
    let ticks = 0;
    while (state.stacker >= 1 && ticks < 5) {
        rwRainTick(state);
        state.stacker -= 1;
        ticks++;
    }
    state.stacker = state.stacker >= 1 ? 0 : state.stacker;
    rwRainDraw(state, state.stacker);
    state.raf = window.requestAnimationFrame(state.frame);
}

/**
 * Starts or stops the rain animation loop. Stopping also clears the canvas.
 * @param {object} state The rain state.
 * @param {boolean} running Whether the rain should run.
 */
function rwRainSetRunning(state, running) {
    if (!state || state.running === running) return;
    state.running = running;
    if (running) {
        state.lastNow = performance.now();
        state.stacker = 0;
        state.raf = window.requestAnimationFrame(state.frame);
    } else {
        if (state.raf !== null) {
            window.cancelAnimationFrame(state.raf);
            state.raf = null;
        }
        state.gl.clear(state.gl.COLOR_BUFFER_BIT);
    }
}

/**
 * Starts the rain background. The rain does not start when the person asks for less motion, because it has bright flashes.
 */
async function rwRainStart() {
    const canvas = document.getElementById('rw-rain-canvas');
    const toggle = document.getElementById('rw-rain-toggle');
    const toggleGroup = document.getElementById('rw-rain-toggle-group');
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) {
        return;
    }
    try {
        const noise = await rwTitleLoadImage(RW_RAIN_NOISE_URL);
        const program = rwRainCreateProgram(gl);
        gl.useProgram(program);
        const floatCount = (3 + RW_RAIN_MAX_DROPS) * 6 * RW_RAIN_FLOATS_PER_VERTEX;
        rwRainCreateBuffer(gl, program, floatCount);
        rwRainCreateNoiseTexture(gl, noise);
        gl.uniform1i(gl.getUniformLocation(program, 'u_noise'), 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 1);
        const state = { gl: gl, canvas: canvas, viewUniform: gl.getUniformLocation(program, 'u_view'), vertices: new Float32Array(floatCount), cursor: 0, drops: [], width: RW_RAIN_SCREEN_WIDTH, pixelSize: 1, lastNow: performance.now(), stacker: 0, lightning: 0, lastLightning: 0, lightningIntensity: 0, dropOff: 1, extraLightningChance: 0, highlightPos: 0, rainDirs: [], frame: null, running: false, raf: null };
        for (let j = 0; j < 2; j++) {
            state.rainDirs.push([rwRainRandomVector(Math.random() * 20), rwRainRandomVector(Math.random() * 10)]);
        }
        rwRainResize(state);
        state.frame = function (now) {
            rwRainFrame(state, now);
        };
        if (toggle) {
            toggle.checked = true;
            toggle.addEventListener('change', function () {
                rwRainSetRunning(state, toggle.checked);
            });
        }
        if (toggleGroup) toggleGroup.hidden = false;
        rwRainSetRunning(state, !toggle || toggle.checked);
    } catch (error) {
        console.log(error);
    }
}

document.addEventListener('DOMContentLoaded', rwRainStart);
