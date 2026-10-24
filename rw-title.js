const RW_TITLE_IMAGE_URL = 'resources/menu/maintitledownpour.png';
const RW_TITLE_GRADIENT_URL = 'resources/menu/textgradient.png';
const RW_TITLE_RAIN_DIVISOR = 5;
const RW_TITLE_SPRITE_RED = 0;

/**
 * Returns the source text of a shader script element.
 * @param {string} id The id of the script element.
 * @returns {string} The shader source.
 */
function rwTitleGetSource(id) {
    return document.getElementById(id).textContent;
}

/**
 * Compiles one shader and throws an error if the compile fails.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {number} type The shader type.
 * @param {string} source The shader source.
 * @returns {WebGLShader} The compiled shader.
 */
function rwTitleCompile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

/**
 * Creates and links the shader program for the title.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @returns {WebGLProgram} The linked program.
 */
function rwTitleCreateProgram(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, rwTitleCompile(gl, gl.VERTEX_SHADER, rwTitleGetSource('rw-title-vs')));
    gl.attachShader(program, rwTitleCompile(gl, gl.FRAGMENT_SHADER, rwTitleGetSource('rw-title-fs')));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
}

/**
 * Loads an image file.
 * @param {string} url The image URL.
 * @returns {Promise<HTMLImageElement>} A promise for the loaded image.
 */
function rwTitleLoadImage(url) {
    return new Promise(function (resolve, reject) {
        const image = new Image();
        image.onload = function () {
            resolve(image);
        };
        image.onerror = function () {
            reject(new Error('Cannot load ' + url));
        };
        image.src = url;
    });
}

/**
 * Uploads an image to a texture unit. The texture uses point filtering and clamped edges.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {HTMLImageElement} image The image to upload.
 * @param {number} unit The texture unit index.
 * @returns {WebGLTexture} The new texture.
 */
function rwTitleCreateTexture(gl, image, unit) {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

/**
 * Sets up the full-screen quad that carries the title image.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {WebGLProgram} program The shader program.
 */
function rwTitleCreateQuad(gl, program) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

/**
 * Shows the plain title image when WebGL is not available.
 * @param {HTMLCanvasElement} canvas The canvas to replace.
 */
function rwTitleShowFallback(canvas) {
    const image = new Image();
    image.className = canvas.className + ' rw-title-fallback';
    image.alt = canvas.getAttribute('aria-label');
    image.src = RW_TITLE_IMAGE_URL;
    canvas.replaceWith(image);
}

/**
 * Draws one frame. The shader reads the screen position of each pixel, so the code sends the canvas rectangle in window units.
 * @param {object} state The title state.
 * @param {number} now The frame time in milliseconds.
 */
function rwTitleDraw(state, now) {
    const gl = state.gl;
    const canvas = state.canvas;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const windowWidth = document.documentElement.clientWidth;
    const windowHeight = document.documentElement.clientHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(state.uniforms.rect, rect.left, windowHeight - rect.bottom, rect.width, rect.height);
    gl.uniform2f(state.uniforms.window, windowWidth, windowHeight);
    gl.uniform1f(state.uniforms.rain, ((now - state.start) / 1000) / RW_TITLE_RAIN_DIVISOR);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    window.requestAnimationFrame(state.frame);
}

/**
 * Starts the animated title.
 */
async function rwTitleStart() {
    const canvas = document.getElementById('rw-title-canvas');
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) {
        rwTitleShowFallback(canvas);
        return;
    }
    try {
        const images = await Promise.all([rwTitleLoadImage(RW_TITLE_IMAGE_URL), rwTitleLoadImage(RW_TITLE_GRADIENT_URL)]);
        const program = rwTitleCreateProgram(gl);
        gl.useProgram(program);
        rwTitleCreateQuad(gl, program);
        rwTitleCreateTexture(gl, images[0], 0);
        rwTitleCreateTexture(gl, images[1], 1);
        gl.uniform1i(gl.getUniformLocation(program, 'u_main'), 0);
        gl.uniform1i(gl.getUniformLocation(program, 'u_gradient'), 1);
        gl.uniform1f(gl.getUniformLocation(program, 'u_gradientWidth'), images[1].width);
        gl.uniform1f(gl.getUniformLocation(program, 'u_spriteRed'), RW_TITLE_SPRITE_RED);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        const state = { gl: gl, canvas: canvas, start: performance.now(), frame: null, uniforms: { rect: gl.getUniformLocation(program, 'u_rect'), window: gl.getUniformLocation(program, 'u_window'), rain: gl.getUniformLocation(program, 'u_rain') } };
        state.frame = function (now) {
            rwTitleDraw(state, now);
        };
        window.requestAnimationFrame(state.frame);
    } catch (error) {
        console.log(error);
        rwTitleShowFallback(canvas);
    }
}

document.addEventListener('DOMContentLoaded', rwTitleStart);
