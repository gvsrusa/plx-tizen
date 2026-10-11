// node test.js
const assert = require('assert');
const { nearest, canDirect, fmt, qs } = require('./app.js');

const r = (left, top) => ({ left, top, width: 10, height: 10 });
const row = [r(0, 0), r(20, 0), r(40, 0), r(20, 30)];
assert.strictEqual(nearest(r(20, 0), row, 'right'), 2);
assert.strictEqual(nearest(r(20, 0), row, 'left'), 0);
assert.strictEqual(nearest(r(20, 0), row, 'down'), 3);
assert.strictEqual(nearest(r(20, 0), row, 'up'), -1);
// stays in its row rather than jumping to a closer diagonal
assert.strictEqual(nearest(r(0, 0), [r(0, 0), r(30, 0), r(12, 25)], 'right'), 1);

assert(canDirect({ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' }));
assert(!canDirect({ container: 'mkv', videoCodec: 'h264', audioCodec: 'aac' }));
assert(!canDirect({ container: 'mp4', videoCodec: 'h264', audioCodec: 'truehd' }));
assert(!canDirect(undefined));

assert.strictEqual(fmt(65), '1:05');
assert.strictEqual(fmt(3725), '1:02:05');
assert.strictEqual(qs({ a: 'x y', b: '/p?q' }), 'a=x%20y&b=%2Fp%3Fq');
console.log('ok');
