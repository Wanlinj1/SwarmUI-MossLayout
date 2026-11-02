/** MOSS Layout: a visual editor for MOSS-Image Layout prompts in the Generate tab.
 * Draw boxes on a canvas sized like the image, caption them, and 'Apply' writes the compiled layout JSON
 * (abs_centralized, yxyx) into the prompt box and sets the image size. */
/** The geometry behind the smart guides: what a moving box can snap to, and what to highlight once it has.
 * A box is [x1, y1, x2, y2]; axis 0 measures along x, axis 1 along y. */
class MossLayoutSnap {
    /** How much two boxes share on the axis across this one. */
    static overlap(a, b, axis) {
        return Math.min(a[3 - axis], b[3 - axis]) - Math.max(a[1 - axis], b[1 - axis]);
    }

    /** Everything that stays still during a drag: the other boxes, their lines, and every gap between boxes or from a box to a canvas edge. */
    static context(others, width, height) {
        let ctx = { others: others, size: [width, height], lines: [[], []], lengths: [[], []], pool: [[], []], gaps: [[], []] };
        for (let axis of [0, 1]) {
            let size = ctx.size[axis];
            ctx.lines[axis].push(0, size / 2, size);
            for (let r of others) {
                ctx.lines[axis].push(r[axis], (r[axis] + r[axis + 2]) / 2, r[axis + 2]);
                ctx.lengths[axis].push(r[axis + 2] - r[axis]);
                // Only the nearer canvas edge counts: a long bar to the far edge says little and makes everything sticky.
                if (r[axis] > 0 && r[axis] <= size - r[axis + 2]) {
                    ctx.pool[axis].push({ axis: axis, start: 0, end: r[axis], crossStart: r[1 - axis], crossEnd: r[3 - axis] });
                }
                if (r[axis + 2] < size && size - r[axis + 2] <= r[axis]) {
                    ctx.pool[axis].push({ axis: axis, start: r[axis + 2], end: size, crossStart: r[1 - axis], crossEnd: r[3 - axis] });
                }
                for (let b of others) {
                    let crossStart = Math.max(r[1 - axis], b[1 - axis]), crossEnd = Math.min(r[3 - axis], b[3 - axis]);
                    if (r[axis + 2] >= b[axis] || crossEnd <= crossStart) {
                        continue;
                    }
                    // Only neighbours: a third box standing in the gap, on the rows these two share, breaks the pair.
                    let blocked = others.some(c => c != r && c != b && c[axis] < b[axis] && c[axis + 2] > r[axis + 2] && Math.min(c[3 - axis], crossEnd) > Math.max(c[1 - axis], crossStart));
                    if (!blocked) {
                        ctx.pool[axis].push({ axis: axis, start: r[axis + 2], end: b[axis], crossStart: crossStart, crossEnd: crossEnd });
                    }
                }
            }
            ctx.gaps[axis] = [...new Set(ctx.pool[axis].map(p => p.end - p.start))];
        }
        return ctx;
    }

    /** What stands in line with the box on this axis, the canvas edges included. */
    static neighbours(ctx, rect, axis) {
        let list = [{ start: 0, end: 0 }, { start: ctx.size[axis], end: ctx.size[axis] }];
        for (let r of ctx.others) {
            if (this.overlap(r, rect, axis) > 0) {
                list.push({ start: r[axis], end: r[axis + 2] });
            }
        }
        return list;
    }

    /** Smallest shift within the threshold; on a tie spacing beats alignment. Returns null when nothing is in reach. */
    static closest(candidates, threshold) {
        let best = null;
        for (let c of candidates) {
            let dist = Math.abs(c[0]);
            if (dist <= threshold && (!best || dist < Math.abs(best[0]) - 0.01 || (dist <= Math.abs(best[0]) + 0.01 && c[1] < best[1]))) {
                best = c;
            }
        }
        return best ? best[0] : null;
    }

    /** The shift that snaps a whole moving box on this axis, or null. */
    static snapMove(ctx, rect, axis, threshold) {
        let s = rect[axis], e = rect[axis + 2], len = e - s;
        let found = [];
        for (let line of ctx.lines[axis]) {
            found.push([line - s, 2], [line - (s + e) / 2, 2], [line - e, 2]);
        }
        let near = this.neighbours(ctx, rect, axis);
        for (let n of near) {
            for (let gap of ctx.gaps[axis]) {
                found.push([n.end + gap - s, 1], [n.start - gap - e, 1]);
            }
            for (let m of near) {
                if (n.end + len <= m.start) {
                    found.push([(n.end + m.start - len) / 2 - s, 1]);
                }
            }
        }
        return this.closest(found, threshold);
    }

    /** The shift that snaps one edge of a box being resized, or null. */
    static snapEdge(ctx, rect, axis, side, threshold) {
        let isEnd = side == 'end';
        let v = rect[axis + (isEnd ? 2 : 0)], fixed = rect[axis + (isEnd ? 0 : 2)];
        let found = ctx.lines[axis].map(line => [line - v, 2]);
        for (let n of this.neighbours(ctx, rect, axis)) {
            for (let gap of ctx.gaps[axis]) {
                found.push([(isEnd ? n.start - gap : n.end + gap) - v, 1]);
            }
        }
        for (let len of ctx.lengths[axis]) {
            found.push([(isEnd ? fixed + len : fixed - len) - v, 3]);
        }
        return this.closest(found, threshold);
    }

    /** The lines, spacing ranges and matching sizes to highlight for a box in place. anchors[axis] lists which of its parts moved: start, center, end. */
    static guides(ctx, rect, anchors, sizes) {
        let out = [];
        let seen = new Set();
        let add = g => {
            let key = JSON.stringify(g);
            if (!seen.has(key)) {
                seen.add(key);
                out.push(g);
            }
        };
        for (let axis of [0, 1]) {
            let size = ctx.size[axis], s = rect[axis], e = rect[axis + 2];
            let values = { start: s, center: (s + e) / 2, end: e };
            for (let anchor of anchors[axis]) {
                let v = values[anchor];
                let from = rect[1 - axis], to = rect[3 - axis], hit = false;
                for (let r of ctx.others) {
                    if ([r[axis], (r[axis] + r[axis + 2]) / 2, r[axis + 2]].some(t => Math.abs(t - v) <= 0.75)) {
                        hit = true;
                        from = Math.min(from, r[1 - axis]);
                        to = Math.max(to, r[3 - axis]);
                    }
                }
                if (Math.abs(v - size / 2) <= 0.75) {
                    hit = true;
                    from = 0;
                    to = ctx.size[1 - axis];
                }
                if (hit) {
                    add({ type: 'line', axis: axis, at: v, from: from, to: to });
                }
            }
            let own = [];
            let inLine = ctx.others.filter(r => this.overlap(r, rect, axis) > 0);
            let crossOf = r => ({ crossStart: Math.max(r[1 - axis], rect[1 - axis]), crossEnd: Math.min(r[3 - axis], rect[3 - axis]) });
            if (anchors[axis].includes('start') || anchors[axis].includes('center')) {
                if (s > 0 && s <= size - e) {
                    own.push({ axis: axis, start: 0, end: s, crossStart: rect[1 - axis], crossEnd: rect[3 - axis] });
                }
                let before = inLine.filter(r => r[axis + 2] <= s).sort((a, b) => b[axis + 2] - a[axis + 2])[0];
                if (before && before[axis + 2] < s) {
                    own.push({ axis: axis, start: before[axis + 2], end: s, ...crossOf(before) });
                }
            }
            if (anchors[axis].includes('end') || anchors[axis].includes('center')) {
                if (e < size && size - e <= s) {
                    own.push({ axis: axis, start: e, end: size, crossStart: rect[1 - axis], crossEnd: rect[3 - axis] });
                }
                let after = inLine.filter(r => r[axis] >= e).sort((a, b) => a[axis] - b[axis])[0];
                if (after && after[axis] > e) {
                    own.push({ axis: axis, start: e, end: after[axis], ...crossOf(after) });
                }
            }
            for (let g of own) {
                let gap = g.end - g.start;
                let same = ctx.pool[axis].filter(p => Math.abs(p.end - p.start - gap) <= 1);
                let twin = own.filter(o => o != g && Math.abs(o.end - o.start - gap) <= 1);
                if (same.length || twin.length) {
                    add({ type: 'gap', ...g });
                    same.forEach(p => add({ type: 'gap', ...p }));
                }
            }
            if (sizes[axis]) {
                let len = e - s;
                let sameSize = ctx.others.filter(r => Math.abs(r[axis + 2] - r[axis] - len) <= 0.75);
                if (sameSize.length) {
                    add({ type: 'size', axis: axis, start: s, end: e, cross: rect[1 - axis] });
                    sameSize.forEach(r => add({ type: 'size', axis: axis, start: r[axis], end: r[axis + 2], cross: r[1 - axis] }));
                }
            }
        }
        return out;
    }
}

class MossLayoutEditor {
    constructor() {
        this.storageKey = 'moss_layout_draft';
        this.draft = this.emptyDraft(1344, 768);
        this.selected = -1;
        this.drag = null;
        this.guides = [];
        this.clipboard = null;
        this.repeat = null;
        this.history = [];
        this.historyIndex = -1;
        this.modal = null;
        this.box = getRequiredElementById('alt_prompt_textbox');
        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'basic-button moss-layout-button';
        this.button.innerText = '🧩 MOSS Layout';
        this.button.title = 'Open the MOSS-Image Layout editor: draw boxes, caption them, and put the layout prompt in the prompt box.';
        this.button.addEventListener('click', () => this.open());
        getRequiredElementById('alt_prompt_region').appendChild(this.button);
        let place = () => {
            let pe = document.querySelector('.pe-enhance-button');
            if (pe && pe.offsetWidth) {
                this.button.style.left = `${pe.offsetLeft + pe.offsetWidth + 6}px`;
            }
        };
        place();
        setTimeout(place, 1000);
        window.addEventListener('resize', place);
    }

    emptyDraft(width, height) {
        return { width: width, height: height, bbox_coord_space: 'abs', bbox_format: 'xyxy', summary: { caption: '' }, items: [] };
    }

    /** Builds the popup on first use. */
    buildModal() {
        document.body.insertAdjacentHTML('beforeend', `
        <div class="modal" tabindex="-1" role="dialog" id="moss_layout_modal">
            <div class="modal-dialog moss-layout-dialog" role="document">
                <div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">MOSS-Image Layout</h5></div>
                    <div class="modal-body moss-layout-body">
                        <div class="moss-layout-left">
                            <div class="moss-layout-toolbar">
                                <label>W <input type="number" class="auto-number" id="moss_layout_w" step="16" min="256"></label>
                                <label>H <input type="number" class="auto-number" id="moss_layout_h" step="16" min="256"></label>
                                <button type="button" class="basic-button" id="moss_layout_from_swarm" title="Take width and height from the Generate tab">⟵ Swarm size</button>
                                <label title="Snap box edges to a 16 px grid when no smart guide is in reach"><input type="checkbox" id="moss_layout_snap" checked> snap 16</label>
                                <label title="Snap to other boxes and the canvas: alignment, equal spacing, equal distance from an edge, equal size"><input type="checkbox" id="moss_layout_smart" checked> smart guides</label>
                                <span class="moss-layout-hint moss-layout-keys">Drag: move · handles: resize (Shift: keep ratio, Alt: from center) · Alt or Ctrl + drag: copy · Shift + drag: straight line · Ctrl+D: copy again by the same step · Ctrl+C/V · Ctrl+Z/Y · arrows: 1 px (Shift: 16) · Esc: cancel the drag · Del</span>
                            </div>
                            <div class="moss-layout-stage-wrap" id="moss_layout_stage_wrap">
                                <div class="moss-layout-stage" id="moss_layout_stage"></div>
                            </div>
                        </div>
                        <div class="moss-layout-right">
                            <label class="moss-layout-field">Scene caption (summary)
                                <textarea class="auto-text" id="moss_layout_caption" rows="4" placeholder="Global description of the whole image: setting, style, lighting..."></textarea>
                            </label>
                            <div class="moss-layout-row">
                                <label class="moss-layout-field moss-layout-grow">Meta tags <input type="text" class="auto-text" id="moss_layout_meta" placeholder="anime illustration, poster"></label>
                                <label class="moss-layout-field">Canvas <select class="auto-dropdown" id="moss_layout_canvas"><option value="">-</option><option>single</option><option>multi_panel</option><option>collage</option></select></label>
                            </div>
                            <div class="moss-layout-items-head">Boxes <span class="moss-layout-hint">(first = back, last = front)</span></div>
                            <div class="moss-layout-items" id="moss_layout_items"></div>
                            <div class="moss-layout-item-editor" id="moss_layout_item_editor"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <span class="moss-layout-error" id="moss_layout_error"></span>
                        <button type="button" class="btn btn-secondary basic-button" id="moss_layout_load_prompt" title="Read a layout prompt that is already in the prompt box back into the editor">Load from prompt</button>
                        <button type="button" class="btn btn-secondary basic-button" id="moss_layout_json" title="Show or paste the editable draft JSON">Draft JSON</button>
                        <button type="button" class="btn btn-secondary basic-button" id="moss_layout_clear">Clear</button>
                        <button type="button" class="btn btn-primary basic-button" id="moss_layout_apply">Apply to prompt</button>
                        <button type="button" class="btn btn-secondary basic-button" id="moss_layout_close">Close</button>
                    </div>
                </div>
            </div>
        </div>`);
        this.modal = getRequiredElementById('moss_layout_modal');
        this.stage = getRequiredElementById('moss_layout_stage');
        this.stageWrap = getRequiredElementById('moss_layout_stage_wrap');
        this.itemsList = getRequiredElementById('moss_layout_items');
        this.itemEditor = getRequiredElementById('moss_layout_item_editor');
        this.errorBox = getRequiredElementById('moss_layout_error');
        this.inW = getRequiredElementById('moss_layout_w');
        this.inH = getRequiredElementById('moss_layout_h');
        this.inCaption = getRequiredElementById('moss_layout_caption');
        this.inMeta = getRequiredElementById('moss_layout_meta');
        this.inCanvas = getRequiredElementById('moss_layout_canvas');
        this.inSnap = getRequiredElementById('moss_layout_snap');
        this.inSmart = getRequiredElementById('moss_layout_smart');
        let setSize = () => {
            this.draft.width = this.roundSize(this.inW.value);
            this.draft.height = this.roundSize(this.inH.value);
            this.clampAll();
            this.render();
            this.commit();
        };
        this.inW.addEventListener('change', setSize);
        this.inH.addEventListener('change', setSize);
        getRequiredElementById('moss_layout_from_swarm').addEventListener('click', () => {
            let [w, h] = this.swarmSize();
            this.inW.value = w;
            this.inH.value = h;
            setSize();
        });
        this.inCaption.addEventListener('input', () => { this.draft.summary.caption = this.inCaption.value; this.save(); });
        this.inMeta.addEventListener('input', () => { this.setList(this.draft.summary, 'meta', this.inMeta.value); this.save(); });
        this.inCaption.addEventListener('change', () => this.commit());
        this.inMeta.addEventListener('change', () => this.commit());
        this.inCanvas.addEventListener('change', () => {
            if (this.inCanvas.value) {
                this.draft.summary.canvas = this.inCanvas.value;
            }
            else {
                delete this.draft.summary.canvas;
            }
            this.save();
            this.commit();
        });
        this.stage.addEventListener('pointerdown', e => this.pointerDown(e));
        window.addEventListener('pointermove', e => this.pointerMove(e));
        window.addEventListener('pointerup', () => this.pointerUp());
        window.addEventListener('pointercancel', () => this.cancelDrag());
        // On the window, in the capture phase: a click often leaves the focus outside the popup, and Esc during a drag must not close it.
        window.addEventListener('keydown', e => this.keyDown(e), true);
        window.addEventListener('keyup', e => this.modifierChanged(e), true);
        new ResizeObserver(() => this.render()).observe(this.stageWrap);
        getRequiredElementById('moss_layout_apply').addEventListener('click', () => this.apply());
        getRequiredElementById('moss_layout_close').addEventListener('click', () => $(this.modal).modal('hide'));
        getRequiredElementById('moss_layout_clear').addEventListener('click', () => {
            if (confirm('Remove all boxes and the scene caption?')) {
                this.draft = this.emptyDraft(this.draft.width, this.draft.height);
                this.selected = -1;
                this.syncInputs();
                this.render();
                this.renderItemEditor();
                this.commit();
            }
        });
        getRequiredElementById('moss_layout_load_prompt').addEventListener('click', () => this.loadFromPrompt());
        getRequiredElementById('moss_layout_json').addEventListener('click', () => this.editJson());
    }

    open() {
        if (!this.modal) {
            this.buildModal();
            let stored = null;
            try {
                stored = JSON.parse(localStorage.getItem(this.storageKey));
            }
            catch (e) { }
            if (stored && stored.items) {
                this.draft = stored;
            }
            else {
                let [w, h] = this.swarmSize();
                this.draft = this.emptyDraft(w, h);
            }
        }
        // If the prompt box holds a layout prompt that the editor does not, offer to start from it.
        if ((this.parseCompiled(this.box.value) || this.parseDraft(this.box.value)) && this.box.value.trim() != this.lastApplied) {
            if (confirm('The prompt box holds a MOSS layout prompt. Load it into the editor?')) {
                this.loadFromPrompt();
            }
        }
        this.syncInputs();
        this.renderItemEditor();
        this.commit();
        $(this.modal).modal('show');
        setTimeout(() => this.render(), 200);
    }

    swarmSize() {
        let w = parseInt(document.getElementById('input_width')?.value) || 1024;
        let h = parseInt(document.getElementById('input_height')?.value) || 1024;
        return [this.roundSize(w), this.roundSize(h)];
    }

    roundSize(v) {
        return Math.max(256, Math.round((parseInt(v) || 1024) / 16) * 16);
    }

    setList(obj, key, text) {
        let list = text.split(',').map(s => s.trim()).filter(s => s);
        if (list.length) {
            obj[key] = list;
        }
        else {
            delete obj[key];
        }
    }

    syncInputs() {
        this.inW.value = this.draft.width;
        this.inH.value = this.draft.height;
        this.inCaption.value = this.draft.summary.caption || '';
        this.inMeta.value = (this.draft.summary.meta || []).join(', ');
        this.inCanvas.value = this.draft.summary.canvas || '';
    }

    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.draft));
        }
        catch (e) { }
    }

    /** Records the draft for undo, if it changed. */
    commit() {
        let state = JSON.stringify(this.draft);
        if (this.history[this.historyIndex] == state) {
            return;
        }
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(state);
        if (this.history.length > 200) {
            this.history.shift();
        }
        this.historyIndex = this.history.length - 1;
    }

    /** Moves through the undo history: -1 undoes, +1 redoes. */
    travel(step) {
        let index = this.historyIndex + step;
        if (index < 0 || index >= this.history.length) {
            return;
        }
        this.historyIndex = index;
        this.draft = JSON.parse(this.history[index]);
        this.selected = Math.min(this.selected, this.draft.items.length - 1);
        this.repeat = null;
        this.syncInputs();
        this.render();
        this.renderItemEditor();
    }

    /** Pixels per image pixel on screen. */
    scale() {
        let wrap = this.stageWrap.getBoundingClientRect();
        return Math.max(0.05, Math.min((wrap.width - 4) / this.draft.width, (wrap.height - 4) / this.draft.height));
    }

    snap(v) {
        return this.inSnap.checked ? Math.round(v / 16) * 16 : Math.round(v);
    }

    clampAll() {
        for (let item of this.draft.items) {
            let b = item.bbox;
            b[0] = Math.max(0, Math.min(b[0], this.draft.width - 16));
            b[1] = Math.max(0, Math.min(b[1], this.draft.height - 16));
            b[2] = Math.max(b[0] + 16, Math.min(b[2], this.draft.width));
            b[3] = Math.max(b[1] + 16, Math.min(b[3], this.draft.height));
        }
    }

    render() {
        if (!this.modal) {
            return;
        }
        let s = this.scale();
        this.stage.style.width = `${this.draft.width * s}px`;
        this.stage.style.height = `${this.draft.height * s}px`;
        this.stage.style.backgroundSize = `${16 * 4 * s}px ${16 * 4 * s}px`;
        this.stage.innerHTML = '';
        this.draft.items.forEach((item, i) => {
            let [x1, y1, x2, y2] = item.bbox;
            let div = document.createElement('div');
            div.className = `moss-layout-box moss-layout-${item.label}` + (i == this.selected ? ' moss-layout-selected' : '');
            div.style.left = `${x1 * s}px`;
            div.style.top = `${y1 * s}px`;
            div.style.width = `${(x2 - x1) * s}px`;
            div.style.height = `${(y2 - y1) * s}px`;
            div.dataset.index = i;
            let title = document.createElement('div');
            title.className = 'moss-layout-box-title';
            title.innerText = `${i + 1} · ${item.label}` + (item.label == 'text' && item.text ? ` "${item.text}"` : '');
            let body = document.createElement('div');
            body.className = 'moss-layout-box-body';
            body.innerText = item.caption || '';
            div.append(title, body);
            for (let dir of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
                let handle = document.createElement('div');
                handle.className = `moss-layout-handle moss-layout-handle-${dir}`;
                handle.dataset.dir = dir;
                div.appendChild(handle);
            }
            this.stage.appendChild(div);
        });
        this.renderGuides(s);
        this.renderList();
        this.save();
    }

    renderGuides(s) {
        let layer = document.createElement('div');
        layer.className = 'moss-layout-guides';
        let place = (className, left, top, width, height, label) => {
            let div = document.createElement('div');
            div.className = className;
            div.style.left = `${left * s}px`;
            div.style.top = `${top * s}px`;
            if (width !== null) {
                div.style.width = `${width * s}px`;
            }
            if (height !== null) {
                div.style.height = `${height * s}px`;
            }
            if (label !== null) {
                let tag = document.createElement('span');
                tag.className = 'moss-layout-guide-label';
                tag.innerText = label;
                div.appendChild(tag);
            }
            layer.appendChild(div);
        };
        for (let g of this.guides) {
            let length = Math.round(g.end - g.start);
            if (g.type == 'line') {
                if (g.axis == 0) {
                    place('moss-layout-guide-line moss-layout-guide-v', g.at, g.from, null, g.to - g.from, null);
                }
                else {
                    place('moss-layout-guide-line moss-layout-guide-h', g.from, g.at, g.to - g.from, null, null);
                }
            }
            else if (g.type == 'gap') {
                if (g.axis == 0) {
                    place('moss-layout-guide-gap moss-layout-guide-gap-x', g.start, g.crossStart, g.end - g.start, g.crossEnd - g.crossStart, length);
                }
                else {
                    place('moss-layout-guide-gap moss-layout-guide-gap-y', g.crossStart, g.start, g.crossEnd - g.crossStart, g.end - g.start, length);
                }
            }
            else if (g.axis == 0) {
                place('moss-layout-guide-size moss-layout-guide-size-x', g.start, g.cross, g.end - g.start, null, length);
            }
            else {
                place('moss-layout-guide-size moss-layout-guide-size-y', g.cross, g.start, null, g.end - g.start, length);
            }
        }
        if (this.drag && this.drag.moved && this.draft.items[this.drag.index]) {
            let [x1, y1, x2, y2] = this.draft.items[this.drag.index].bbox;
            let tag = document.createElement('div');
            tag.className = 'moss-layout-guide-dims';
            tag.innerText = `${x1}, ${y1} · ${x2 - x1} × ${y2 - y1}`;
            tag.style.left = `${x1 * s}px`;
            tag.style.top = `${y2 * s}px`;
            layer.appendChild(tag);
        }
        this.stage.appendChild(layer);
    }

    renderList() {
        this.itemsList.innerHTML = '';
        this.draft.items.forEach((item, i) => {
            let row = document.createElement('div');
            row.className = `moss-layout-item-row moss-layout-${item.label}` + (i == this.selected ? ' moss-layout-selected' : '');
            let [x1, y1, x2, y2] = item.bbox;
            row.innerHTML = `<span class="moss-layout-item-name"></span><span class="moss-layout-item-dims">${x1},${y1} → ${x2},${y2}</span>`
                + `<button type="button" class="basic-button" data-act="up" title="Move back">▲</button>`
                + `<button type="button" class="basic-button" data-act="down" title="Move to front">▼</button>`
                + `<button type="button" class="basic-button" data-act="dup" title="Duplicate">⧉</button>`
                + `<button type="button" class="basic-button" data-act="del" title="Delete">✕</button>`;
            row.querySelector('.moss-layout-item-name').innerText = `${i + 1} · ${item.label}: ${item.label == 'text' ? `"${item.text || ''}"` : (item.caption || '').slice(0, 40)}`;
            row.addEventListener('click', e => {
                let act = e.target.dataset.act;
                if (act == 'del') {
                    this.removeItem(i);
                    return;
                }
                if (act == 'dup') {
                    this.selected = i;
                    this.duplicateSelected();
                    return;
                }
                if (act == 'up' || act == 'down') {
                    let j = act == 'up' ? i - 1 : i + 1;
                    if (j >= 0 && j < this.draft.items.length) {
                        [this.draft.items[i], this.draft.items[j]] = [this.draft.items[j], this.draft.items[i]];
                        this.selected = j;
                    }
                }
                else {
                    this.selected = i;
                }
                this.render();
                this.renderItemEditor();
                this.commit();
            });
            this.itemsList.appendChild(row);
        });
    }

    renderItemEditor() {
        let item = this.draft.items[this.selected];
        if (!item) {
            this.itemEditor.innerHTML = '<div class="moss-layout-hint">Draw a box on the canvas, or click one to edit it.</div>';
            return;
        }
        this.itemEditor.innerHTML = `
            <div class="moss-layout-row">
                <label class="moss-layout-field">Type <select class="auto-dropdown" data-key="label"><option>character</option><option>object</option><option>text</option></select></label>
                <span class="moss-layout-hint">Box ${this.selected + 1}</span>
            </div>
            <label class="moss-layout-field">Caption <textarea class="auto-text" rows="4" data-key="caption" placeholder="What is in this box and how it looks (for text: font, color, style)"></textarea></label>
            <label class="moss-layout-field moss-layout-text-field">Exact text <textarea class="auto-text" rows="2" data-key="text" placeholder="The literal characters to render; Enter = line break"></textarea></label>
            <label class="moss-layout-field">Tags <input type="text" class="auto-text" data-key="tags" placeholder="optional, comma separated"></label>
            <label class="moss-layout-field">Palette <input type="text" class="auto-text" data-key="palette" placeholder="optional, e.g. #ffffff, deep navy"></label>`;
        let textField = this.itemEditor.querySelector('.moss-layout-text-field');
        let refreshText = () => textField.style.display = item.label == 'text' ? '' : 'none';
        for (let input of this.itemEditor.querySelectorAll('[data-key]')) {
            let key = input.dataset.key;
            input.value = Array.isArray(item[key]) ? item[key].join(', ') : (item[key] || '');
            input.addEventListener(input.tagName == 'SELECT' ? 'change' : 'input', () => {
                if (key == 'tags' || key == 'palette') {
                    this.setList(item, key, input.value);
                }
                else if (key == 'text' && !input.value) {
                    delete item.text;
                }
                else {
                    item[key] = input.value;
                }
                if (key == 'label') {
                    refreshText();
                }
                this.render();
            });
            input.addEventListener('change', () => this.commit());
        }
        refreshText();
    }

    removeItem(i) {
        this.draft.items.splice(i, 1);
        this.selected = Math.min(this.selected, this.draft.items.length - 1);
        if (this.selected == i) {
            this.selected = -1;
        }
        this.render();
        this.renderItemEditor();
        this.commit();
    }

    /** Adds a copy of the selected box. After a copy made by dragging, this repeats the same step, so a row stays evenly spaced. */
    duplicateSelected() {
        let item = this.draft.items[this.selected];
        if (!item) {
            return;
        }
        let step = this.repeat && this.repeat.index == this.selected ? this.repeat.step : null;
        let bbox = [...item.bbox];
        let [dx, dy] = step || [32, 32];
        let shifted = [bbox[0] + dx, bbox[1] + dy, bbox[2] + dx, bbox[3] + dy];
        if (step && (shifted[0] < 0 || shifted[1] < 0 || shifted[2] > this.draft.width || shifted[3] > this.draft.height)) {
            this.errorBox.innerText = 'The next copy by this step would leave the canvas.';
            return;
        }
        this.errorBox.innerText = '';
        this.insertCopy(item, this.fitted(shifted));
        this.repeat = { index: this.selected, step: [dx, dy] };
    }

    /** A box shifted back inside the canvas, its size kept. */
    fitted(b) {
        let dx = Math.max(0, Math.min(b[0], this.draft.width - (b[2] - b[0]))) - b[0];
        let dy = Math.max(0, Math.min(b[1], this.draft.height - (b[3] - b[1]))) - b[1];
        return [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
    }

    insertCopy(item, bbox) {
        let copy = JSON.parse(JSON.stringify(item));
        copy.bbox = bbox;
        this.draft.items.push(copy);
        this.selected = this.draft.items.length - 1;
        this.render();
        this.renderItemEditor();
        this.commit();
    }

    keyDown(e) {
        if (!this.modal || !this.modal.classList.contains('show')) {
            return;
        }
        if (this.drag) {
            this.modifierChanged(e);
            if (e.key == 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.cancelDrag();
            }
            else if (e.key == 'Alt') {
                e.preventDefault();
            }
            return;
        }
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
            return;
        }
        let handled = true;
        let ctrl = e.ctrlKey || e.metaKey;
        let key = e.key.toLowerCase();
        let item = this.draft.items[this.selected];
        if (ctrl && key == 'z') {
            this.travel(e.shiftKey ? 1 : -1);
        }
        else if (ctrl && key == 'y') {
            this.travel(1);
        }
        else if (ctrl && key == 'd') {
            this.duplicateSelected();
        }
        else if (ctrl && key == 'c' && item) {
            this.clipboard = JSON.parse(JSON.stringify(item));
        }
        else if (ctrl && key == 'x' && item) {
            this.clipboard = JSON.parse(JSON.stringify(item));
            this.removeItem(this.selected);
        }
        else if (ctrl && key == 'v' && this.clipboard) {
            let b = this.clipboard.bbox;
            this.insertCopy(this.clipboard, this.fitted([b[0] + 32, b[1] + 32, b[2] + 32, b[3] + 32]));
            this.clipboard = JSON.parse(JSON.stringify(this.draft.items[this.selected]));
        }
        else if (e.key == 'Delete' && item) {
            this.removeItem(this.selected);
        }
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && item) {
            let by = e.shiftKey ? 16 : 1;
            let dx = e.key == 'ArrowLeft' ? -by : e.key == 'ArrowRight' ? by : 0;
            let dy = e.key == 'ArrowUp' ? -by : e.key == 'ArrowDown' ? by : 0;
            let b = item.bbox;
            item.bbox = this.fitted([b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy]);
            this.repeat = null;
            this.render();
            this.commit();
        }
        else {
            handled = false;
        }
        if (handled) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }

    /** Shift, Alt and Ctrl act at once, without waiting for the pointer to move. */
    modifierChanged(e) {
        if (this.drag && this.pointer && ['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) {
            this.pointer.shift = e.shiftKey;
            this.pointer.alt = e.altKey;
            this.pointer.ctrl = e.ctrlKey || e.metaKey;
            this.updateDrag();
        }
    }

    /** Image-space point of a pointer event. */
    point(e) {
        let rect = this.stage.getBoundingClientRect();
        let s = this.scale();
        return [Math.max(0, Math.min(this.draft.width, (e.clientX - rect.left) / s)), Math.max(0, Math.min(this.draft.height, (e.clientY - rect.top) / s))];
    }

    pointerDown(e) {
        if (e.button != 0) {
            return;
        }
        e.preventDefault();
        this.errorBox.innerText = '';
        if (document.activeElement && this.modal.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        let [x, y] = this.point(e);
        this.pointer = { x: x, y: y, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, screenX: e.clientX, screenY: e.clientY };
        let boxDiv = e.target.closest('.moss-layout-box');
        if (boxDiv) {
            let i = parseInt(boxDiv.dataset.index);
            if (i != this.selected) {
                this.repeat = null;
            }
            this.selected = i;
            let dir = e.target.dataset.dir;
            this.drag = { mode: dir ? 'resize' : 'move', dir: dir, index: i, source: i, start: [x, y], screen: [e.clientX, e.clientY], orig: [...this.draft.items[i].bbox], moved: false, copying: false };
        }
        else {
            let sx = this.snap(x), sy = this.snap(y);
            this.draft.items.push({ label: 'character', caption: '', bbox: [sx, sy, sx, sy] });
            this.selected = this.draft.items.length - 1;
            this.repeat = null;
            this.drag = { mode: 'create', index: this.selected, start: [sx, sy], screen: [e.clientX, e.clientY], moved: false };
        }
        this.render();
        this.renderItemEditor();
    }

    pointerMove(e) {
        if (!this.drag) {
            return;
        }
        let [x, y] = this.point(e);
        this.pointer = { x: x, y: y, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, screenX: e.clientX, screenY: e.clientY };
        this.updateDrag();
    }

    /** The still boxes for the current drag. */
    dragContext() {
        if (!this.drag.context) {
            let others = this.draft.items.filter((item, i) => i != this.drag.index).map(item => item.bbox);
            this.drag.context = MossLayoutSnap.context(others, this.draft.width, this.draft.height);
        }
        return this.drag.context;
    }

    /** Reach of the smart guides in image pixels, 0 when they are off. */
    threshold() {
        return this.inSmart.checked ? 5 / this.scale() : 0;
    }

    /** Applies the current pointer and modifiers to the box being dragged. */
    updateDrag() {
        let p = this.pointer, drag = this.drag;
        if (!drag.moved) {
            // A plain click must not nudge the box or leave a copy behind.
            if (Math.hypot(p.screenX - drag.screen[0], p.screenY - drag.screen[1]) < 3) {
                return;
            }
            drag.moved = true;
        }
        if (drag.mode == 'move') {
            this.setCopying(p.alt || p.ctrl);
            this.updateMove();
        }
        else if (drag.mode == 'resize') {
            this.updateResize();
        }
        else {
            this.updateCreate();
        }
        this.render();
    }

    /** Copy on: the original goes back to where it was and the drag carries a new box. Copy off: the new box goes away. */
    setCopying(on) {
        let drag = this.drag;
        if (on == drag.copying) {
            return;
        }
        let source = this.draft.items[drag.source];
        if (on) {
            let copy = JSON.parse(JSON.stringify(source));
            source.bbox = [...drag.orig];
            this.draft.items.push(copy);
            drag.index = this.draft.items.length - 1;
        }
        else {
            source.bbox = this.draft.items[drag.index].bbox;
            this.draft.items.splice(drag.index, 1);
            drag.index = drag.source;
        }
        drag.copying = on;
        drag.context = null;
        this.selected = drag.index;
    }

    updateMove() {
        let p = this.pointer, drag = this.drag;
        let ctx = this.dragContext();
        let reach = this.threshold();
        let delta = [p.x - drag.start[0], p.y - drag.start[1]];
        let locked = !p.shift ? -1 : Math.abs(delta[0]) >= Math.abs(delta[1]) ? 1 : 0;
        let rect = [...drag.orig];
        for (let axis of [0, 1]) {
            if (axis != locked) {
                rect[axis] += delta[axis];
                rect[axis + 2] += delta[axis];
            }
        }
        for (let axis of [0, 1]) {
            if (axis == locked) {
                continue;
            }
            let len = drag.orig[axis + 2] - drag.orig[axis];
            let found = reach ? MossLayoutSnap.snapMove(ctx, rect, axis, reach) : null;
            let start = found !== null ? Math.round(rect[axis] + found) : this.snap(rect[axis]);
            start = Math.max(0, Math.min(ctx.size[axis] - len, start));
            rect[axis] = start;
            rect[axis + 2] = start + len;
        }
        this.draft.items[drag.index].bbox = rect;
        let all = ['start', 'center', 'end'];
        // On a locked axis the box is not going anywhere, so its spacing there is not news.
        this.guides = !this.inSmart.checked ? [] : MossLayoutSnap.guides(ctx, rect, [all, all], [false, false]).filter(g => g.type != 'gap' || g.axis != locked);
    }

    /** Where one dragged edge lands: on a smart guide if one is in reach, else on the grid. */
    snappedEdge(ctx, rect, axis, side, value) {
        let index = axis + (side == 'end' ? 2 : 0);
        let probe = [...rect];
        probe[index] = value;
        let reach = this.threshold();
        let found = reach ? MossLayoutSnap.snapEdge(ctx, probe, axis, side, reach) : null;
        return found !== null ? Math.round(value + found) : this.snap(value);
    }

    updateResize() {
        let p = this.pointer, drag = this.drag;
        let ctx = this.dragContext();
        let o = drag.orig;
        let sides = [drag.dir.includes('w') ? 'start' : drag.dir.includes('e') ? 'end' : null, drag.dir.includes('n') ? 'start' : drag.dir.includes('s') ? 'end' : null];
        let rect = [...o];
        let moved = [p.x - drag.start[0], p.y - drag.start[1]];
        let lengths = [o[2] - o[0], o[3] - o[1]];
        let keepRatio = p.shift && sides[0] && sides[1];
        // With the ratio kept, the pointer rules along one axis and the other follows it.
        let ruling = !keepRatio ? null : Math.abs(moved[0]) / lengths[0] >= Math.abs(moved[1]) / lengths[1] ? 0 : 1;
        for (let axis of [0, 1]) {
            let side = sides[axis];
            if (!side || (keepRatio && axis != ruling)) {
                continue;
            }
            let index = axis + (side == 'end' ? 2 : 0);
            rect[index] = this.fitEdge(axis, side, this.snappedEdge(ctx, rect, axis, side, o[index] + moved[axis]), p.alt);
            if (p.alt) {
                rect[side == 'end' ? axis : axis + 2] = o[axis] + o[axis + 2] - rect[index];
            }
        }
        if (keepRatio) {
            this.followRatio(rect, sides, ruling, p.alt);
        }
        this.draft.items[drag.index].bbox = rect;
        if (!this.inSmart.checked) {
            this.guides = [];
            return;
        }
        let anchors = [0, 1].map(axis => !sides[axis] || (keepRatio && axis != ruling) ? [] : p.alt ? ['start', 'end'] : [sides[axis]]);
        this.guides = MossLayoutSnap.guides(ctx, rect, anchors, anchors.map(a => a.length > 0));
    }

    /** Keeps a dragged edge on the canvas and at least 16 px from the opposite edge, or from the center when resizing from it. */
    fitEdge(axis, side, value, fromCenter) {
        let o = this.drag.orig;
        let size = axis == 0 ? this.draft.width : this.draft.height;
        let center = (o[axis] + o[axis + 2]) / 2;
        if (side == 'end') {
            let max = fromCenter ? Math.min(size, 2 * center) : size;
            return Math.min(max, Math.max(value, fromCenter ? Math.ceil(center + 8) : o[axis] + 16));
        }
        let min = fromCenter ? Math.max(0, 2 * center - size) : 0;
        return Math.max(min, Math.min(value, fromCenter ? Math.floor(center - 8) : o[axis + 2] - 16));
    }

    /** Sizes the box from its ruling axis at the original ratio, within the canvas. */
    followRatio(rect, sides, ruling, fromCenter) {
        let o = this.drag.orig;
        let sizes = [this.draft.width, this.draft.height];
        let lengths = [o[2] - o[0], o[3] - o[1]];
        let scale = (rect[ruling + 2] - rect[ruling]) / lengths[ruling];
        let room = axis => {
            let center = (o[axis] + o[axis + 2]) / 2;
            if (fromCenter) {
                return 2 * Math.min(center, sizes[axis] - center);
            }
            return sides[axis] == 'end' ? sizes[axis] - o[axis] : o[axis + 2];
        };
        scale = Math.max(16 / Math.min(...lengths), Math.min(scale, room(0) / lengths[0], room(1) / lengths[1]));
        for (let axis of [0, 1]) {
            let len = Math.round(lengths[axis] * scale);
            if (fromCenter) {
                let start = Math.round((o[axis] + o[axis + 2] - len) / 2);
                rect[axis] = start;
                rect[axis + 2] = start + len;
            }
            else if (sides[axis] == 'end') {
                rect[axis] = o[axis];
                rect[axis + 2] = o[axis] + len;
            }
            else {
                rect[axis] = o[axis + 2] - len;
                rect[axis + 2] = o[axis + 2];
            }
        }
    }

    updateCreate() {
        let p = this.pointer, drag = this.drag;
        let ctx = this.dragContext();
        let [sx, sy] = drag.start;
        let rect = [sx, sy, sx, sy];
        let sides = [p.x >= sx ? 'end' : 'start', p.y >= sy ? 'end' : 'start'];
        rect[sides[0] == 'end' ? 2 : 0] = this.snappedEdge(ctx, rect, 0, sides[0], p.x);
        rect[sides[1] == 'end' ? 3 : 1] = this.snappedEdge(ctx, rect, 1, sides[1], p.y);
        if (p.shift) {
            let room = [sides[0] == 'end' ? ctx.size[0] - sx : sx, sides[1] == 'end' ? ctx.size[1] - sy : sy];
            let len = Math.min(Math.max(rect[2] - rect[0], rect[3] - rect[1]), room[0], room[1]);
            rect = [sides[0] == 'end' ? sx : sx - len, sides[1] == 'end' ? sy : sy - len, sides[0] == 'end' ? sx + len : sx, sides[1] == 'end' ? sy + len : sy];
        }
        this.draft.items[drag.index].bbox = rect;
        this.guides = this.inSmart.checked ? MossLayoutSnap.guides(ctx, rect, [[sides[0]], [sides[1]]], [true, true]) : [];
    }

    pointerUp() {
        if (!this.drag) {
            return;
        }
        let drag = this.drag;
        let item = this.draft.items[drag.index];
        if (drag.mode == 'create' && item && (item.bbox[2] - item.bbox[0] < 16 || item.bbox[3] - item.bbox[1] < 16)) {
            // A click without a real drag: drop the empty box.
            this.draft.items.splice(drag.index, 1);
            this.selected = -1;
        }
        if (drag.copying && item) {
            this.repeat = { index: drag.index, step: [item.bbox[0] - drag.orig[0], item.bbox[1] - drag.orig[1]] };
        }
        else if (drag.moved) {
            this.repeat = null;
        }
        this.drag = null;
        this.guides = [];
        this.render();
        this.renderItemEditor();
        this.commit();
    }

    /** Esc: everything goes back to how it was before the drag. */
    cancelDrag() {
        let drag = this.drag;
        if (!drag) {
            return;
        }
        if (drag.mode == 'create') {
            this.draft.items.splice(drag.index, 1);
            this.selected = -1;
        }
        else {
            if (drag.copying) {
                this.draft.items.splice(drag.index, 1);
            }
            this.draft.items[drag.source].bbox = [...drag.orig];
            this.selected = drag.source;
        }
        this.drag = null;
        this.guides = [];
        this.render();
        this.renderItemEditor();
    }

    /** Validates the draft and returns the compiled prompt, same rules and output as compile_prompt.py. */
    compile() {
        let d = this.draft;
        if (!d.summary.caption || !d.summary.caption.trim()) {
            throw 'Scene caption is empty.';
        }
        if (!d.items.length) {
            throw 'Draw at least one box.';
        }
        let summary = {};
        for (let key of ['meta', 'canvas', 'caption', 'palette']) {
            if (d.summary[key] !== undefined) {
                summary[key] = d.summary[key];
            }
        }
        let items = d.items.map((item, i) => {
            if (!item.caption || !item.caption.trim()) {
                throw `Box ${i + 1} has no caption.`;
            }
            if (item.label == 'text' && !(item.text || '').trim()) {
                throw `Box ${i + 1} is a text box without exact text.`;
            }
            let [x1, y1, x2, y2] = item.bbox;
            let out = { label: item.label, caption: item.caption };
            if (item.label == 'text') {
                out.text = item.text;
            }
            out.bbox = [Math.floor(y1) - Math.floor(d.height / 2), Math.floor(x1) - Math.floor(d.width / 2), Math.ceil(y2) - Math.floor(d.height / 2), Math.ceil(x2) - Math.floor(d.width / 2)];
            for (let key of ['tags', 'palette']) {
                if (item[key] && item[key].length) {
                    out[key] = item[key];
                }
            }
            return out;
        });
        return JSON.stringify({ summary: summary, items: items, bbox_coord_space: 'abs_centralized', bbox_format: 'yxyx' });
    }

    apply() {
        let prompt;
        try {
            prompt = this.compile();
        }
        catch (e) {
            this.errorBox.innerText = e;
            return;
        }
        this.errorBox.innerText = '';
        this.box.value = prompt;
        this.lastApplied = prompt;
        triggerChangeFor(this.box);
        let inputWidth = document.getElementById('input_width');
        let inputHeight = document.getElementById('input_height');
        let inputAspectRatio = document.getElementById('input_aspectratio');
        if (inputAspectRatio) {
            inputAspectRatio.value = 'Custom';
            triggerChangeFor(inputAspectRatio);
        }
        if (inputWidth && inputHeight) {
            inputWidth.value = this.draft.width;
            inputHeight.value = this.draft.height;
            triggerChangeFor(inputWidth);
            triggerChangeFor(inputHeight);
        }
        $(this.modal).modal('hide');
    }

    /** Parses a compiled layout prompt, or returns null. */
    parseCompiled(text) {
        try {
            let data = JSON.parse(text.trim());
            if (data && data.bbox_coord_space == 'abs_centralized' && data.bbox_format == 'yxyx' && Array.isArray(data.items)) {
                return data;
            }
        }
        catch (e) { }
        return null;
    }

    /** Parses a draft (abs, xyxy, with its own width and height), or returns null. */
    parseDraft(text) {
        try {
            let data = JSON.parse(text.trim());
            if (data && data.bbox_coord_space == 'abs' && data.bbox_format == 'xyxy' && data.width && data.height && data.summary && Array.isArray(data.items)) {
                return data;
            }
        }
        catch (e) { }
        return null;
    }

    loadFromPrompt() {
        let parsedDraft = this.parseDraft(this.box.value);
        if (parsedDraft) {
            this.draft = parsedDraft;
            this.clampAll();
            this.selected = -1;
            this.errorBox.innerText = '';
            this.syncInputs();
            this.render();
            this.renderItemEditor();
            this.commit();
            return;
        }
        let data = this.parseCompiled(this.box.value);
        if (!data) {
            this.errorBox.innerText = 'The prompt box does not hold a MOSS layout prompt.';
            return;
        }
        let [w, h] = this.swarmSize();
        // A compiled prompt has no size of its own: boxes outside the current size mean the size is wrong, and clamping them would wreck the layout.
        if (data.items.some(item => item.bbox[0] < -Math.floor(h / 2) || item.bbox[1] < -Math.floor(w / 2) || item.bbox[2] > h - Math.floor(h / 2) || item.bbox[3] > w - Math.floor(w / 2))) {
            this.errorBox.innerText = `The boxes do not fit ${w}x${h}. Set the image size this prompt was made for, then load again.`;
            return;
        }
        let draft = this.emptyDraft(w, h);
        draft.summary = data.summary || { caption: '' };
        draft.items = data.items.map(item => {
            let [y1, x1, y2, x2] = item.bbox;
            let out = { ...item };
            out.bbox = [x1 + Math.floor(w / 2), y1 + Math.floor(h / 2), x2 + Math.floor(w / 2), y2 + Math.floor(h / 2)];
            return out;
        });
        this.draft = draft;
        this.clampAll();
        this.selected = -1;
        this.lastApplied = this.box.value.trim();
        this.errorBox.innerText = '';
        this.syncInputs();
        this.render();
        this.renderItemEditor();
        this.commit();
    }

    editJson() {
        let text = prompt('Draft JSON (width, height, summary, items with bbox as x1, y1, x2, y2 in pixels). Edit or paste a draft, then OK:', JSON.stringify(this.draft));
        if (text === null || text.trim() == JSON.stringify(this.draft)) {
            return;
        }
        try {
            let draft = JSON.parse(text);
            if (!draft.width || !draft.height || !draft.summary || !Array.isArray(draft.items)) {
                throw 'Needs width, height, summary and items.';
            }
            draft.bbox_coord_space = 'abs';
            draft.bbox_format = 'xyxy';
            this.draft = draft;
            this.selected = -1;
            this.errorBox.innerText = '';
            this.syncInputs();
            this.render();
            this.renderItemEditor();
            this.commit();
        }
        catch (e) {
            this.errorBox.innerText = `Bad draft JSON: ${e}`;
        }
    }
}

if (typeof document != 'undefined') {
    mossLayoutEditor = new MossLayoutEditor();
}
if (typeof module != 'undefined') {
    module.exports = { MossLayoutSnap };
}
