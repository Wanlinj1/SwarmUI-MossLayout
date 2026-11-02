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
        this.selection = [];
        this.drag = null;
        this.guides = [];
        this.marquee = null;
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

    /** The box the side panel edits: the last one selected, or -1. */
    get selected() {
        return this.selection.length ? this.selection[this.selection.length - 1] : -1;
    }

    set selected(index) {
        this.selection = index >= 0 ? [index] : [];
    }

    /** Gives a field what Swarm gives its own prompt boxes: tag and <...> completion, including what other extensions register, and Ctrl+Up/Down weights. Other extensions can listen for moss-layout-prompt-field on document to add their own. */
    connectPromptField(box) {
        if (typeof textPromptAddKeydownHandler == 'function') {
            textPromptAddKeydownHandler(box);
            // Esc closes the list of suggestions, not the whole editor.
            box.addEventListener('keydown', e => {
                if (e.key == 'Escape' && promptTabComplete.popover) {
                    promptTabComplete.popover = null;
                    e.stopPropagation();
                }
            });
        }
        // A chosen suggestion sets the value from code, and then a browser may not send change.
        box.addEventListener('blur', () => this.commit());
        box.dispatchEvent(new CustomEvent('moss-layout-prompt-field', { bubbles: true }));
    }

    /** The list of suggestions belongs to a field that may be about to go. */
    closeSuggestions() {
        if (typeof promptTabComplete != 'undefined' && promptTabComplete.popover) {
            promptTabComplete.popover.remove();
            promptTabComplete.popover = null;
        }
    }

    /** A group's letter on the canvas and in the list, or nothing for a box outside groups. */
    groupLetter(item) {
        let index = (this.draft.groups || []).findIndex(g => g.id == item.group);
        return index < 0 ? '' : String.fromCharCode(65 + index % 26);
    }

    groupOf(item) {
        return (this.draft.groups || []).find(g => g.id == item.group);
    }

    /** Boxes of a group go together: selecting one selects them all, with this one last. */
    selectBox(i) {
        let group = this.draft.items[i].group;
        let members = [];
        if (group !== undefined) {
            this.draft.items.forEach((item, j) => {
                if (item.group == group && j != i) {
                    members.push(j);
                }
            });
        }
        this.selection = [...members, i];
    }

    /** Makes the selected boxes one group with a shared prompt. */
    groupSelected() {
        if (this.selection.length < 2) {
            return;
        }
        this.draft.groups = this.draft.groups || [];
        let id = Math.max(0, ...this.draft.groups.map(g => g.id)) + 1;
        this.draft.groups.push({ id: id, caption: '' });
        this.selection.forEach(i => this.draft.items[i].group = id);
        this.afterGrouping();
    }

    /** Takes the selected boxes out of their groups. The shared prompt stays with the boxes that remain, or goes with the last of them. */
    ungroupSelected() {
        this.selection.forEach(i => delete this.draft.items[i].group);
        this.afterGrouping();
    }

    afterGrouping() {
        this.repeat = null;
        this.pruneGroups();
        this.render();
        this.renderItemEditor();
        this.commit();
    }

    pruneGroups() {
        if (!this.draft.groups) {
            return;
        }
        this.draft.groups = this.draft.groups.filter(g => this.draft.items.some(item => item.group == g.id));
        if (!this.draft.groups.length) {
            delete this.draft.groups;
        }
    }

    /** Copies of a whole group become a new group, a separate character with the same text to start from. Copies of a part stay in the group. */
    regroupCopies(copies) {
        this.draft.groups = this.draft.groups || [];
        let known = [...this.draft.groups, ...(this.clipboardGroups || [])];
        let map = new Map();
        for (let copy of copies) {
            let old = copy.group;
            if (old === undefined || map.has(old)) {
                continue;
            }
            let wanted = copies.filter(c => c.group == old).length;
            let there = this.draft.items.filter(item => item.group == old).length;
            let source = known.find(g => g.id == old);
            if (source && (wanted >= there)) {
                let id = Math.max(0, ...this.draft.groups.map(g => g.id)) + 1;
                this.draft.groups.push({ id: id, caption: source.caption });
                map.set(old, id);
            }
            else {
                map.set(old, source ? old : undefined);
            }
        }
        for (let copy of copies) {
            if (map.get(copy.group) !== undefined) {
                copy.group = map.get(copy.group);
            }
            else {
                delete copy.group;
            }
        }
        // Copies of a whole set of linked boxes are linked to each other; a copy of a part stays linked to the rest.
        let links = new Map();
        let next = Math.max(0, ...this.draft.items.map(item => item.link || 0)) + 1;
        for (let copy of copies) {
            if (copy.link === undefined) {
                continue;
            }
            if (!links.has(copy.link)) {
                let whole = copies.filter(c => c.link == copy.link).length >= this.draft.items.filter(item => item.link == copy.link).length;
                links.set(copy.link, whole ? next++ : copy.link);
            }
        }
        for (let copy of copies) {
            if (copy.link !== undefined) {
                copy.link = links.get(copy.link);
            }
        }
    }

    /** The selected boxes get one caption: edit it in any of them and all change. They still move on their own. */
    linkSelected() {
        if (this.selection.length < 2) {
            return;
        }
        let id = Math.max(0, ...this.draft.items.map(item => item.link || 0)) + 1;
        let caption = this.draft.items[this.selected].caption;
        this.selection.forEach(i => {
            this.draft.items[i].link = id;
            this.draft.items[i].caption = caption;
        });
        this.afterGrouping();
    }

    unlinkSelected() {
        this.selection.forEach(i => delete this.draft.items[i].link);
        this.afterGrouping();
    }

    linkedTo(item) {
        return item.link === undefined ? [] : this.draft.items.filter(x => x.link == item.link);
    }

    pruneLinks() {
        for (let item of this.draft.items) {
            if (item.link !== undefined && this.linkedTo(item).length < 2) {
                delete item.link;
            }
        }
    }

    copyToClipboard() {
        this.clipboard = JSON.parse(JSON.stringify(this.selection.map(i => this.draft.items[i])));
        this.clipboardGroups = JSON.parse(JSON.stringify(this.draft.groups || []));
    }

    /** The smallest box around these boxes. */
    boundsOf(indices) {
        let boxes = indices.map(i => this.draft.items[i].bbox);
        return [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
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
                                <button type="button" class="basic-button" id="moss_layout_duplicate" title="Copy the selection (Ctrl+D)">⧉ Duplicate</button>
                                <button type="button" class="basic-button" id="moss_layout_undo" title="Undo (Ctrl+Z)">↶ Undo</button>
                                <button type="button" class="basic-button" id="moss_layout_redo" title="Redo (Ctrl+Y)">↷ Redo</button>
                                <label title="Snap box edges to a 16 px grid when no smart guide is in reach"><input type="checkbox" id="moss_layout_snap" checked> snap 16</label>
                                <label title="Snap to other boxes and the canvas: alignment, equal spacing, equal distance from an edge, equal size"><input type="checkbox" id="moss_layout_smart" checked> smart guides</label>
                            </div>
                            <div class="moss-layout-stage-wrap" id="moss_layout_stage_wrap">
                                <div class="moss-layout-stage" id="moss_layout_stage"></div>
                            </div>
                            <div class="moss-layout-legend">
                                <div class="moss-layout-legend-group"><b>Draw</b><div><kbd>Drag empty space</kbd> new box</div><div><kbd>Shift + drag</kbd> square</div></div>
                                <div class="moss-layout-legend-group"><b>Select</b><div><kbd>Click</kbd> one box or group</div><div><kbd>Click it again</kbd> one box of the group</div><div><kbd>Ctrl + click</kbd> add or remove</div><div><kbd>Ctrl + drag empty space</kbd> select with a frame</div><div><kbd>Ctrl+A</kbd> all</div><div><kbd>Click empty space</kbd> none</div></div>
                                <div class="moss-layout-legend-group"><b>Move</b><div><kbd>Drag</kbd> move the selection</div><div><kbd>Shift + drag</kbd> straight line</div><div><kbd>Arrows</kbd> 1 px</div><div><kbd>Shift + arrows</kbd> 16 px</div><div><kbd>Esc</kbd> cancel the drag</div></div>
                                <div class="moss-layout-legend-group"><b>Copy</b><div><kbd>Alt or Ctrl + drag</kbd> copy</div><div><kbd>Alt + Shift + drag</kbd> copy in a straight line</div><div><kbd>Ctrl+D</kbd> copy again by the same step</div><div><kbd>Ctrl+C / X / V</kbd> copy, cut, paste</div></div>
                                <div class="moss-layout-legend-group"><b>Resize</b><div><kbd>Drag a handle</kbd> resize</div><div><kbd>Shift + corner</kbd> keep the ratio</div><div><kbd>Alt + handle</kbd> from the center</div><div><kbd>Handles of a group</kbd> scale all of it</div></div>
                                <div class="moss-layout-legend-group"><b>Character</b><div><kbd>Ctrl+G</kbd> group the selection, one shared prompt</div><div><kbd>Ctrl+Shift+G</kbd> ungroup</div><div><kbd>Ctrl+L</kbd> link captions: edit one, all change</div><div><kbd>Ctrl+Shift+L</kbd> unlink</div></div>
                                <div class="moss-layout-legend-group"><b>Edit</b><div><kbd>Ctrl+Z / Ctrl+Y</kbd> undo, redo</div><div><kbd>Del</kbd> delete the selection</div></div>
                            </div>
                        </div>
                        <div class="moss-layout-right">
                            <label class="moss-layout-field moss-layout-fill">Scene caption (summary)
                                <textarea class="auto-text moss-layout-big" id="moss_layout_caption" rows="9" placeholder="Global description of the whole image: setting, style, lighting..."></textarea>
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
                        <button type="button" class="btn btn-secondary basic-button" id="moss_layout_clear" title="Remove all boxes and the scene caption">Clear</button>
                        <button type="button" class="btn btn-primary basic-button" id="moss_layout_apply" title="Write the compiled layout into the prompt box and set the image size">Apply to prompt</button>
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
        this.undoButton = getRequiredElementById('moss_layout_undo');
        this.redoButton = getRequiredElementById('moss_layout_redo');
        getRequiredElementById('moss_layout_duplicate').addEventListener('click', () => this.duplicateSelected());
        this.undoButton.addEventListener('click', () => this.travel(-1));
        this.redoButton.addEventListener('click', () => this.travel(1));
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
        this.connectPromptField(this.inCaption);
        this.connectPromptField(this.inMeta);
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
        if ((this.parseCompiled(this.box.value) || this.parseDraft(this.box.value)) && this.box.value.trim() != this.lastApplied && !this.promptIsDraft()) {
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

    promptIsDraft() {
        try {
            return this.box.value.trim() == this.compile();
        }
        catch (e) {
            return false;
        }
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
        this.pruneGroups();
        this.pruneLinks();
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
        this.refreshUndo();
    }

    refreshUndo() {
        this.undoButton.disabled = this.historyIndex <= 0;
        this.redoButton.disabled = this.historyIndex >= this.history.length - 1;
    }

    /** Moves through the undo history: -1 undoes, +1 redoes. */
    travel(step) {
        let index = this.historyIndex + step;
        if (index < 0 || index >= this.history.length) {
            return;
        }
        this.historyIndex = index;
        this.refreshUndo();
        this.draft = JSON.parse(this.history[index]);
        this.selection = this.selection.filter(i => i < this.draft.items.length);
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
        this.stage.classList.toggle('moss-layout-several', this.selection.length > 1);
        this.draft.items.forEach((item, i) => {
            let [x1, y1, x2, y2] = item.bbox;
            let div = document.createElement('div');
            div.className = `moss-layout-box moss-layout-${item.label}` + (this.selection.includes(i) ? ' moss-layout-selected' : '');
            div.style.left = `${x1 * s}px`;
            div.style.top = `${y1 * s}px`;
            div.style.width = `${(x2 - x1) * s}px`;
            div.style.height = `${(y2 - y1) * s}px`;
            div.dataset.index = i;
            let title = document.createElement('div');
            title.className = 'moss-layout-box-title';
            let letter = this.groupLetter(item);
            title.innerText = (letter ? `${letter} · ` : '') + (item.link !== undefined ? '🔗 ' : '') + `${i + 1} · ${item.label}` + (item.label == 'text' && item.text ? ` "${item.text}"` : '');
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
        this.renderGroupFrame(s);
        this.renderGuides(s);
        this.renderList();
        this.save();
    }

    /** The frame around several selected boxes; its handles scale them all. */
    renderGroupFrame(s) {
        if (this.selection.length < 2) {
            return;
        }
        let [x1, y1, x2, y2] = this.boundsOf(this.selection);
        let frame = document.createElement('div');
        frame.className = 'moss-layout-group-frame';
        frame.style.left = `${x1 * s}px`;
        frame.style.top = `${y1 * s}px`;
        frame.style.width = `${(x2 - x1) * s}px`;
        frame.style.height = `${(y2 - y1) * s}px`;
        for (let dir of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
            let handle = document.createElement('div');
            handle.className = `moss-layout-handle moss-layout-handle-${dir}`;
            handle.dataset.dir = dir;
            frame.appendChild(handle);
        }
        this.stage.appendChild(frame);
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
        if (this.marquee) {
            let [x1, y1, x2, y2] = this.marquee;
            place('moss-layout-guide-marquee', x1, y1, x2 - x1, y2 - y1, null);
        }
        if (this.drag && this.drag.moved && this.drag.moving && this.drag.moving.length) {
            let [x1, y1, x2, y2] = this.boundsOf(this.drag.moving);
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
            row.className = `moss-layout-item-row moss-layout-${item.label}` + (this.selection.includes(i) ? ' moss-layout-selected' : '');
            let [x1, y1, x2, y2] = item.bbox;
            row.innerHTML = `<span class="moss-layout-item-name"></span><span class="moss-layout-item-dims">${x1},${y1} → ${x2},${y2}</span>`
                + `<button type="button" class="basic-button" data-act="up" title="Move back">▲</button>`
                + `<button type="button" class="basic-button" data-act="down" title="Move to front">▼</button>`
                + `<button type="button" class="basic-button" data-act="dup" title="Duplicate">⧉</button>`
                + `<button type="button" class="basic-button" data-act="del" title="Delete">✕</button>`;
            let rowLetter = this.groupLetter(item);
            row.querySelector('.moss-layout-item-name').innerText = (rowLetter ? `${rowLetter} · ` : '') + (item.link !== undefined ? '🔗 ' : '') + `${i + 1} · ${item.label}: ${item.label == 'text' ? `"${item.text || ''}"` : (item.caption || '').slice(0, 40)}`;
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
                else if (e.ctrlKey || e.metaKey) {
                    this.toggleSelected(i);
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

    toggleSelected(i) {
        if (this.selection.includes(i)) {
            this.selection = this.selection.filter(j => j != i);
        }
        else {
            this.selection.push(i);
        }
        this.repeat = null;
    }

    renderItemEditor() {
        this.closeSuggestions();
        if (this.selection.length > 1) {
            let first = this.draft.items[this.selection[0]];
            let group = this.groupOf(first);
            let whole = group && this.selection.every(i => this.draft.items[i].group == group.id) && this.selection.length == this.draft.items.filter(x => x.group == group.id).length;
            this.itemEditor.innerHTML = '';
            if (whole) {
                this.addGroupField(group, 'Ungroup');
                this.addHint('Click one of its boxes again to edit that part.');
                return;
            }
            this.addHint(`${this.selection.length} boxes selected: move, scale, copy or delete them together. Select one to edit its text.`);
            let button = document.createElement('button');
            button.type = 'button';
            button.className = 'basic-button';
            button.innerText = 'Group as one character (Ctrl+G)';
            button.title = 'Give these boxes one shared prompt, added to the caption of each of them when you Apply';
            button.addEventListener('click', () => this.groupSelected());
            this.itemEditor.appendChild(button);
            let link = document.createElement('button');
            link.type = 'button';
            link.className = 'basic-button';
            link.innerText = 'Link their captions (Ctrl+L)';
            link.title = 'They take the caption of the last selected box. Edit it in any of them and all change. They still move on their own.';
            link.addEventListener('click', () => this.linkSelected());
            this.itemEditor.appendChild(link);
            return;
        }
        let item = this.draft.items[this.selected];
        if (!item) {
            this.itemEditor.innerHTML = '<div class="moss-layout-hint">Draw a box on the canvas, or click one to edit it.</div>';
            return;
        }
        this.itemEditor.innerHTML = `
            <div class="moss-layout-row">
                <label class="moss-layout-field">Box ${this.selected + 1} <select class="auto-dropdown" data-key="label"><option>character</option><option>object</option><option>text</option></select></label>
                <label class="moss-layout-field moss-layout-grow">Tags <input type="text" class="auto-text" data-key="tags" placeholder="optional, comma separated"></label>
                <label class="moss-layout-field moss-layout-grow">Palette <input type="text" class="auto-text" data-key="palette" placeholder="optional, e.g. #ffffff, navy"></label>
            </div>
            <label class="moss-layout-field moss-layout-fill">Caption <textarea class="auto-text moss-layout-big" rows="9" data-key="caption" placeholder="What is in this box and how it looks (for text: font, color, style)"></textarea></label>
            <label class="moss-layout-field moss-layout-text-field">Exact text <textarea class="auto-text moss-layout-medium" rows="4" data-key="text" placeholder="The literal characters to render; Enter = line break"></textarea></label>
`;
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
                if (key == 'caption') {
                    this.linkedTo(item).forEach(x => x.caption = input.value);
                }
                if (key == 'label') {
                    refreshText();
                }
                this.render();
            });
            input.addEventListener('change', () => this.commit());
            if (key == 'caption' || key == 'tags') {
                this.connectPromptField(input);
            }
        }
        refreshText();
        let group = item && this.groupOf(item);
        if (group) {
            this.addGroupField(group, 'Take this box out of the group');
            this.itemEditor.prepend(this.itemEditor.lastChild);
            this.itemEditor.querySelector('[data-key=caption]').placeholder = 'Only what is special to this part, e.g. Her left arm, ending at the ring.';
            this.itemEditor.querySelector('[data-key=caption]').closest('label').firstChild.textContent = 'This part ';
        }
        let linked = this.linkedTo(item).length;
        if (linked) {
            let label = this.itemEditor.querySelector('[data-key=caption]').closest('label');
            label.firstChild.textContent = `${label.firstChild.textContent.trim()}: linked, same in ${linked} boxes `;
            let button = document.createElement('button');
            button.type = 'button';
            button.className = 'basic-button moss-layout-ungroup';
            button.innerText = 'Unlink this box';
            button.addEventListener('click', e => { e.preventDefault(); this.unlinkSelected(); });
            label.appendChild(button);
        }
    }

    addHint(text) {
        let hint = document.createElement('div');
        hint.className = 'moss-layout-hint';
        hint.innerText = text;
        this.itemEditor.appendChild(hint);
    }

    /** The prompt a group shares, and the button that ends the grouping. */
    addGroupField(group, buttonText) {
        let count = this.draft.items.filter(x => x.group == group.id).length;
        let field = document.createElement('label');
        field.className = 'moss-layout-field moss-layout-fill';
        field.innerText = `Character ${String.fromCharCode(65 + this.draft.groups.indexOf(group) % 26)}: shared by ${count} boxes `;
        let text = document.createElement('textarea');
        text.className = 'auto-text moss-layout-big';
        text.rows = 6;
        text.placeholder = 'Who this is: appearance, clothes, expression. Apply puts it before the caption of each of these boxes.';
        text.value = group.caption || '';
        text.addEventListener('input', () => { group.caption = text.value; this.save(); });
        text.addEventListener('change', () => this.commit());
        this.connectPromptField(text);
        field.appendChild(text);
        let button = document.createElement('button');
        button.type = 'button';
        button.className = 'basic-button moss-layout-ungroup';
        button.innerText = buttonText;
        button.addEventListener('click', e => { e.preventDefault(); this.ungroupSelected(); });
        field.appendChild(button);
        this.itemEditor.appendChild(field);
    }

    removeItem(i) {
        this.removeItems([i]);
    }

    removeItems(indices) {
        this.draft.items = this.draft.items.filter((item, i) => !indices.includes(i));
        // The boxes that stay selected keep their place in the selection, under their new numbers.
        this.selection = this.selection.filter(i => !indices.includes(i)).map(i => i - indices.filter(j => j < i).length);
        this.repeat = null;
        this.render();
        this.renderItemEditor();
        this.commit();
    }

    /** Adds copies of the selected boxes. After copies made by dragging, this repeats the same step, so a row stays evenly spaced. */
    duplicateSelected() {
        if (!this.selection.length) {
            return;
        }
        let same = this.repeat && this.repeat.indices.join() == this.selection.join();
        let [dx, dy] = same ? this.repeat.step : [32, 32];
        let b = this.boundsOf(this.selection);
        let shifted = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
        if (same && (shifted[0] < 0 || shifted[1] < 0 || shifted[2] > this.draft.width || shifted[3] > this.draft.height)) {
            this.errorBox.innerText = 'The next copy by this step would leave the canvas.';
            return;
        }
        this.errorBox.innerText = '';
        let fit = this.fitted(shifted);
        this.insertCopies(this.selection.map(i => this.draft.items[i]), fit[0] - b[0], fit[1] - b[1]);
        this.repeat = { indices: [...this.selection], step: [dx, dy] };
    }

    /** A box shifted back inside the canvas, its size kept. */
    fitted(b) {
        let dx = Math.max(0, Math.min(b[0], this.draft.width - (b[2] - b[0]))) - b[0];
        let dy = Math.max(0, Math.min(b[1], this.draft.height - (b[3] - b[1]))) - b[1];
        return [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
    }

    /** Adds copies of these items, shifted, and selects them. */
    insertCopies(items, dx, dy) {
        let first = this.draft.items.length;
        let copies = [];
        for (let item of items) {
            let copy = JSON.parse(JSON.stringify(item));
            let b = copy.bbox;
            copy.bbox = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
            copies.push(copy);
        }
        this.regroupCopies(copies);
        this.draft.items.push(...copies);
        this.selection = items.map((item, i) => first + i);
        this.render();
        this.renderItemEditor();
        this.commit();
    }

    keyDown(e) {
        if (!this.modal || !this.modal.classList.contains('show')) {
            return;
        }
        let ctrl = e.ctrlKey || e.metaKey;
        // On a non-Latin layout e.key is the local letter (Ctrl+A gives 'ф'), so go by the physical key there.
        let key = /^[a-z]$/i.test(e.key) || !(e.code || '').startsWith('Key') ? e.key.toLowerCase() : e.code.slice(3).toLowerCase();
        // Browsers bind Ctrl+D to a bookmark, and it means nothing in text, so it stays ours wherever the focus is.
        let duplicate = ctrl && key == 'd';
        if (this.drag) {
            if (duplicate) {
                e.preventDefault();
            }
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
        // A clicked checkbox or dropdown keeps the focus, but only text fields have a use for Ctrl+A and the like. A dropdown still needs its arrows.
        let tag = e.target.tagName;
        if (!duplicate && (tag == 'TEXTAREA' || (tag == 'INPUT' && e.target.type != 'checkbox') || (tag == 'SELECT' && !ctrl))) {
            return;
        }
        let handled = true;
        let item = this.draft.items[this.selected];
        if (ctrl && key == 'z') {
            this.travel(e.shiftKey ? 1 : -1);
        }
        else if (ctrl && key == 'y') {
            this.travel(1);
        }
        else if (ctrl && key == 'a') {
            this.selection = this.draft.items.map((it, i) => i);
            this.repeat = null;
            this.render();
            this.renderItemEditor();
        }
        else if (ctrl && key == 'd') {
            this.duplicateSelected();
        }
        else if (ctrl && key == 'g') {
            if (e.shiftKey) {
                this.ungroupSelected();
            }
            else {
                this.groupSelected();
            }
        }
        else if (ctrl && key == 'l') {
            if (e.shiftKey) {
                this.unlinkSelected();
            }
            else {
                this.linkSelected();
            }
        }
        else if (ctrl && key == 'c' && item) {
            this.copyToClipboard();
        }
        else if (ctrl && key == 'x' && item) {
            this.copyToClipboard();
            this.removeItems(this.selection);
        }
        else if (ctrl && key == 'v' && this.clipboard) {
            let boxes = this.clipboard.map(c => c.bbox);
            let b = [Math.min(...boxes.map(x => x[0])), Math.min(...boxes.map(x => x[1])), Math.max(...boxes.map(x => x[2])), Math.max(...boxes.map(x => x[3]))];
            let fit = this.fitted([b[0] + 32, b[1] + 32, b[2] + 32, b[3] + 32]);
            this.insertCopies(this.clipboard, fit[0] - b[0], fit[1] - b[1]);
            // The next paste steps on from this one.
            this.copyToClipboard();
        }
        else if (e.key == 'Delete' && item) {
            this.removeItems(this.selection);
        }
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && item) {
            let by = e.shiftKey ? 16 : 1;
            let dx = e.key == 'ArrowLeft' ? -by : e.key == 'ArrowRight' ? by : 0;
            let dy = e.key == 'ArrowUp' ? -by : e.key == 'ArrowDown' ? by : 0;
            let b = this.boundsOf(this.selection);
            let fit = this.fitted([b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy]);
            for (let i of this.selection) {
                let box = this.draft.items[i].bbox;
                this.draft.items[i].bbox = [box[0] + fit[0] - b[0], box[1] + fit[1] - b[1], box[2] + fit[0] - b[0], box[3] + fit[1] - b[1]];
            }
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
        let ctrl = e.ctrlKey || e.metaKey;
        let boxDiv = e.target.closest('.moss-layout-box');
        if (e.target.closest('.moss-layout-group-frame')) {
            let moving = [...this.selection];
            let origs = moving.map(i => [...this.draft.items[i].bbox]);
            let orig = this.boundsOf(moving);
            // No box of the group may shrink below 16 px.
            let minLength = [0, 1].map(axis => Math.ceil((orig[axis + 2] - orig[axis]) * 16 / Math.min(...origs.map(b => b[axis + 2] - b[axis]))));
            this.drag = { mode: 'resize', dir: e.target.dataset.dir, moving: moving, origs: origs, orig: orig, minLength: minLength, start: [x, y], screen: [e.clientX, e.clientY], moved: false };
        }
        else if (boxDiv) {
            let i = parseInt(boxDiv.dataset.index);
            let wasSelected = this.selection.includes(i);
            // Ctrl waits for the release: a click toggles the box, a drag copies.
            if (!wasSelected && !ctrl) {
                this.selectBox(i);
                this.repeat = null;
            }
            let dir = e.target.dataset.dir;
            if (dir) {
                let orig = [...this.draft.items[i].bbox];
                this.drag = { mode: 'resize', dir: dir, moving: [i], origs: [orig], orig: orig, minLength: [16, 16], start: [x, y], screen: [e.clientX, e.clientY], moved: false };
            }
            else {
                this.drag = { mode: 'move', hit: i, wasSelected: wasSelected, ctrlPress: ctrl, start: [x, y], screen: [e.clientX, e.clientY], moved: false, copying: false };
            }
        }
        else if (ctrl) {
            this.drag = { mode: 'marquee', start: [x, y], screen: [e.clientX, e.clientY], base: [...this.selection], moved: false };
        }
        else {
            let sx = this.snap(x), sy = this.snap(y);
            this.draft.items.push({ label: 'character', caption: '', bbox: [sx, sy, sx, sy] });
            this.selected = this.draft.items.length - 1;
            this.repeat = null;
            this.drag = { mode: 'create', index: this.selected, moving: [this.selected], start: [sx, sy], screen: [e.clientX, e.clientY], moved: false };
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
            let others = this.draft.items.filter((item, i) => !this.drag.moving.includes(i)).map(item => item.bbox);
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
            if (drag.mode == 'move') {
                this.startMove();
            }
        }
        if (drag.mode == 'move') {
            this.setCopying(p.alt || p.ctrl);
            this.updateMove();
        }
        else if (drag.mode == 'marquee') {
            this.updateMarquee();
        }
        else if (drag.mode == 'resize') {
            this.updateResize();
        }
        else {
            this.updateCreate();
        }
        this.render();
    }

    /** The drag has really begun: fixes which boxes it carries and where they stood. */
    startMove() {
        let drag = this.drag;
        if (!drag.wasSelected) {
            this.selectBox(drag.hit);
            this.repeat = null;
        }
        drag.sources = [...this.selection];
        drag.moving = drag.sources;
        drag.origs = drag.sources.map(i => [...this.draft.items[i].bbox]);
        drag.orig = this.boundsOf(drag.sources);
    }

    /** Copy on: the originals go back to where they were and the drag carries new boxes. Copy off: the new boxes go away. */
    setCopying(on) {
        let drag = this.drag;
        if (on == drag.copying) {
            return;
        }
        if (on) {
            let copies = drag.sources.map(i => JSON.parse(JSON.stringify(this.draft.items[i])));
            drag.sources.forEach((i, n) => this.draft.items[i].bbox = [...drag.origs[n]]);
            let first = this.draft.items.length;
            this.regroupCopies(copies);
            this.draft.items.push(...copies);
            drag.moving = copies.map((c, n) => first + n);
        }
        else {
            drag.sources.forEach((i, n) => this.draft.items[i].bbox = this.draft.items[drag.moving[n]].bbox);
            this.draft.items.length -= drag.moving.length;
            this.pruneGroups();
            drag.moving = drag.sources;
        }
        drag.copying = on;
        drag.context = null;
        this.selection = [...drag.moving];
    }

    updateMarquee() {
        let p = this.pointer, drag = this.drag;
        let m = [Math.min(drag.start[0], p.x), Math.min(drag.start[1], p.y), Math.max(drag.start[0], p.x), Math.max(drag.start[1], p.y)];
        this.marquee = m;
        let inside = [];
        this.draft.items.forEach((item, i) => {
            let b = item.bbox;
            if (b[0] < m[2] && b[2] > m[0] && b[1] < m[3] && b[3] > m[1] && !drag.base.includes(i)) {
                inside.push(i);
            }
        });
        // A frame that touches one box of a group takes the group.
        for (let i of [...inside]) {
            let group = this.draft.items[i].group;
            if (group !== undefined) {
                this.draft.items.forEach((item, j) => {
                    if (item.group == group && !inside.includes(j) && !drag.base.includes(j)) {
                        inside.push(j);
                    }
                });
            }
        }
        this.selection = [...drag.base, ...inside];
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
        drag.moving.forEach((i, n) => {
            let o = drag.origs[n];
            this.draft.items[i].bbox = [o[0] + rect[0] - drag.orig[0], o[1] + rect[1] - drag.orig[1], o[2] + rect[0] - drag.orig[0], o[3] + rect[1] - drag.orig[1]];
        });
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
        this.applyScale(rect);
        if (!this.inSmart.checked) {
            this.guides = [];
            return;
        }
        let anchors = [0, 1].map(axis => !sides[axis] || (keepRatio && axis != ruling) ? [] : p.alt ? ['start', 'end'] : [sides[axis]]);
        this.guides = MossLayoutSnap.guides(ctx, rect, anchors, anchors.map(a => a.length > 0));
    }

    /** Fits every dragged box into its share of the new frame. Each edge rounds on its own, so boxes that touched still touch. */
    applyScale(rect) {
        let drag = this.drag, o = drag.orig;
        let sx = (rect[2] - rect[0]) / (o[2] - o[0]), sy = (rect[3] - rect[1]) / (o[3] - o[1]);
        drag.moving.forEach((i, n) => {
            let b = drag.origs[n];
            this.draft.items[i].bbox = [Math.round(rect[0] + (b[0] - o[0]) * sx), Math.round(rect[1] + (b[1] - o[1]) * sy), Math.round(rect[0] + (b[2] - o[0]) * sx), Math.round(rect[1] + (b[3] - o[1]) * sy)];
        });
    }

    /** Keeps a dragged edge on the canvas and clear of the opposite edge, or of the center when resizing from it, by the smallest allowed length. */
    fitEdge(axis, side, value, fromCenter) {
        let o = this.drag.orig;
        let least = this.drag.minLength[axis];
        let size = axis == 0 ? this.draft.width : this.draft.height;
        let center = (o[axis] + o[axis + 2]) / 2;
        if (side == 'end') {
            let max = fromCenter ? Math.min(size, 2 * center) : size;
            return Math.min(max, Math.max(value, fromCenter ? Math.ceil(center + least / 2) : o[axis] + least));
        }
        let min = fromCenter ? Math.max(0, 2 * center - size) : 0;
        return Math.max(min, Math.min(value, fromCenter ? Math.floor(center - least / 2) : o[axis + 2] - least));
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
        scale = Math.max(this.drag.minLength[0] / lengths[0], this.drag.minLength[1] / lengths[1], Math.min(scale, room(0) / lengths[0], room(1) / lengths[1]));
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
        if (drag.mode == 'move' && !drag.moved) {
            if (drag.ctrlPress) {
                this.toggleSelected(drag.hit);
            }
            else if (drag.wasSelected && this.selection.length > 1) {
                this.selected = drag.hit;
                this.repeat = null;
            }
        }
        else if (drag.mode == 'move' && drag.copying) {
            let b = this.boundsOf(drag.moving);
            this.repeat = { indices: [...drag.moving], step: [b[0] - drag.orig[0], b[1] - drag.orig[1]] };
        }
        else if (drag.moved) {
            this.repeat = null;
        }
        this.drag = null;
        this.guides = [];
        this.marquee = null;
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
        else if (drag.mode == 'marquee') {
            this.selection = drag.base;
        }
        else if (drag.mode == 'resize') {
            drag.moving.forEach((i, n) => this.draft.items[i].bbox = [...drag.origs[n]]);
        }
        else if (drag.moved) {
            if (drag.copying) {
                this.draft.items.length -= drag.moving.length;
                this.pruneGroups();
            }
            drag.sources.forEach((i, n) => this.draft.items[i].bbox = [...drag.origs[n]]);
            this.selection = [...drag.sources];
        }
        this.drag = null;
        this.guides = [];
        this.marquee = null;
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
            let group = this.groupOf(item);
            let caption = [group ? group.caption : '', item.caption].map(c => (c || '').trim()).filter(c => c).join(' ');
            if (!caption) {
                throw `Box ${i + 1} has no caption.`;
            }
            if (item.label == 'text' && !(item.text || '').trim()) {
                throw `Box ${i + 1} is a text box without exact text.`;
            }
            let [x1, y1, x2, y2] = item.bbox;
            let out = { label: item.label, caption: caption };
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
