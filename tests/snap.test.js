// The snapping geometry, without a browser or SwarmUI. Run: node --test tests/snap.test.js
const test = require('node:test');
const assert = require('node:assert');
const { MossLayoutSnap: Snap } = require('../Assets/moss_layout.js');

const W = 1000, H = 600;
const ALL = ['start', 'center', 'end'];
const box = (x, y, w, h) => [x, y, x + w, y + h];
const gaps = (ctx, rect, axis) => Snap.guides(ctx, rect, [ALL, ALL], [false, false]).filter(g => g.type == 'gap' && g.axis == axis);
const lines = (ctx, rect, axis) => Snap.guides(ctx, rect, [ALL, ALL], [false, false]).filter(g => g.type == 'line' && g.axis == axis);

test('a third box takes the gap between the other two', () => {
    let ctx = Snap.context([box(100, 100, 100, 100), box(300, 100, 100, 100)], W, H);
    let rect = box(497, 100, 100, 100);
    assert.equal(Snap.snapMove(ctx, rect, 0, 5), 3);
    let shown = gaps(ctx, box(500, 100, 100, 100), 0).filter(g => g.end - g.start == 100);
    // The first box also stands 100 from the left edge, so that range matches too.
    assert.deepEqual(shown.map(g => [g.start, g.end]).sort((a, b) => a[0] - b[0]), [[0, 100], [200, 300], [400, 500]]);
});

test('the same works along y', () => {
    let ctx = Snap.context([box(100, 50, 100, 50), box(100, 150, 100, 50)], W, H);
    assert.equal(Snap.snapMove(ctx, box(100, 248, 100, 50), 1, 5), 2);
});

test('a box mirrors the distance of another from the opposite canvas edge', () => {
    let ctx = Snap.context([box(120, 100, 100, 100)], W, H);
    // 120 from the left edge, so right edge at 880.
    assert.equal(Snap.snapMove(ctx, box(677, 300, 200, 100), 0, 5), 3);
    let shown = gaps(ctx, box(680, 300, 200, 100), 0);
    assert.ok(shown.some(g => g.start == 0 && g.end == 120 && g.crossStart == 100));
    assert.ok(shown.some(g => g.start == 880 && g.end == 1000 && g.crossStart == 300));
});

test('a box centers between two neighbours', () => {
    let ctx = Snap.context([box(100, 100, 100, 100), box(600, 100, 100, 100)], W, H);
    // Free space 200..600, box 100 wide: centered at 350.
    assert.equal(Snap.snapMove(ctx, box(347, 100, 100, 100), 0, 5), 3);
    let shown = gaps(ctx, box(350, 100, 100, 100), 0);
    assert.ok(shown.some(g => g.start == 200 && g.end == 350));
    assert.ok(shown.some(g => g.start == 450 && g.end == 600));
});

test('a box in another row does not count as a neighbour', () => {
    let ctx = Snap.context([box(100, 100, 100, 100), box(300, 100, 100, 100)], W, H);
    // Gap of 100 from the box at 300 would put x at 500, but this box is below that row.
    let free = Snap.context([], W, H);
    assert.equal(Snap.snapMove(free, box(497, 400, 100, 100), 0, 2), null);
    assert.notEqual(Snap.snapMove(ctx, box(497, 100, 100, 100), 0, 5), null);
    assert.ok(!gaps(ctx, box(503, 400, 100, 100), 0).some(g => g.start == 400 && g.end == 503));
});

test('alignment: edges and centers meet, and the line spans both boxes', () => {
    let ctx = Snap.context([box(100, 100, 100, 100)], W, H);
    assert.equal(Snap.snapMove(ctx, box(103, 400, 50, 50), 0, 5), -3);
    assert.equal(Snap.snapMove(ctx, box(122, 400, 50, 50), 0, 5), 3); // center 147 to 150
    let line = lines(ctx, box(100, 400, 50, 50), 0).find(g => g.at == 100);
    assert.deepEqual([line.from, line.to], [100, 450]);
});

test('the canvas center draws a full line', () => {
    let ctx = Snap.context([], W, H);
    assert.equal(Snap.snapMove(ctx, box(448, 100, 100, 100), 0, 5), 2);
    let line = lines(ctx, box(450, 100, 100, 100), 0).find(g => g.at == 500);
    assert.deepEqual([line.from, line.to], [0, H]);
});

test('out of reach means no snap', () => {
    let ctx = Snap.context([box(100, 100, 100, 100)], W, H);
    assert.equal(Snap.snapMove(ctx, box(333, 333, 37, 41), 0, 1), null);
});

test('a resized edge snaps to a line, a gap and a matching size', () => {
    let ctx = Snap.context([box(100, 100, 100, 100), box(300, 100, 100, 100), box(700, 100, 150, 100)], W, H);
    assert.equal(Snap.snapEdge(ctx, box(500, 300, 98, 100), 0, 'end', 3), 2); // right edge to 600? no line: size 100
    assert.equal(Snap.snapEdge(ctx, box(500, 300, 148, 50), 0, 'end', 3), 2); // size 150
    assert.equal(Snap.snapEdge(ctx, box(500, 100, 97, 100), 0, 'end', 4), 3); // gap 100 before the box at 700
    let sized = Snap.guides(ctx, box(500, 300, 150, 50), [['end'], []], [true, false]).filter(g => g.type == 'size');
    assert.equal(sized.length, 2);
});

test('only the moved side of a resized box is highlighted', () => {
    let ctx = Snap.context([box(100, 100, 100, 100), box(300, 100, 100, 100)], W, H);
    let g = Snap.guides(ctx, box(500, 100, 50, 100), [['end'], []], [false, false]).filter(g => g.type == 'gap');
    assert.ok(!g.some(x => x.start == 400 && x.end == 500));
});

test('spacing beats alignment on a tie', () => {
    assert.equal(Snap.closest([[2, 2], [2, 1], [3, 0]], 5), 2);
    assert.equal(Snap.closest([[-2, 2], [2, 1]], 5), 2);
});

test('a box hidden by a third is not paired', () => {
    let ctx = Snap.context([box(0, 0, 100, 100), box(150, 0, 100, 100), box(400, 0, 100, 100)], W, H);
    let pairs = ctx.pool[0].filter(p => p.start > 0 && p.end < W).map(p => [p.start, p.end]);
    assert.ok(pairs.some(p => p[0] == 100 && p[1] == 150));
    assert.ok(pairs.some(p => p[0] == 250 && p[1] == 400));
    assert.ok(!pairs.some(p => p[0] == 100 && p[1] == 400));
});
