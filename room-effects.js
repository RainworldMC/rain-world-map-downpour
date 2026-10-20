/* Room coordinates use game pixels, with positive Y upwards (CRS.Simple). */
(function () {
    'use strict';

    const cache = new Map();
    const cardOffsets = new Map();
    const visibilityKey = 'rain-world-map.hidden-effect-types';
    const geometryStyle = {
        color: '#fff',
        weight: 1,
        opacity: 0.85,
        fillOpacity: 0,
        interactive: false,
    };
    const radiusClasses = new Set([
        'LightSourceData',
        'ResizableObjectData',
        'InsectGroupData',
        'ScavengerOutpostData',
        'SnowSourceData',
        'OEsphereData',
        'CellDistortionData',
    ]);

    let selected = null;
    let version = 0;
    let entry = null;
    let filter = '';
    let expanded = true;
    let selectionContext = {};
    const hiddenTypes = loadVisibility();

    const layer = L.layerGroup().addTo(map);
    overlays.addOverlay(layer, 'Room Effects');

    const panel = element('section', 'side-panel effects-inspector rw-text');
    panel.setAttribute('aria-label', 'Room effects');
    panel.hidden = true;
    document.body.appendChild(panel);
    isolateMapEvents(panel);

    function loadVisibility() {
        try {
            const saved = JSON.parse(localStorage.getItem(visibilityKey) || '[]');
            if (Array.isArray(saved)) {
                return new Set(saved.filter(type => typeof type === 'string'));
            }
        } catch (_) {
            // Storage can be unavailable in private or embedded views.
        }
        return new Set();
    }

    function setTypeVisibility(types, visible) {
        for (const type of types) {
            if (visible) {
                hiddenTypes.delete(type);
            } else {
                hiddenTypes.add(type);
            }
        }
        try {
            localStorage.setItem(visibilityKey, JSON.stringify([...hiddenTypes]));
        } catch (_) {
            // Keep in-memory visibility when storage is unavailable.
        }
        drawObjects();
    }

    function label(value) {
        let text = String(value);
        if (/^[A-Z0-9_]+$/.test(text)) {
            text = text.toLowerCase();
        }
        return text
            .replace(/^data_/, '')
            .replace(/_/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\b\w/g, character => character.toUpperCase());
    }

    function format(value) {
        return typeof value === 'number'
            ? String(Math.round(value * 1000) / 1000)
            : String(value);
    }

    function element(tag, className = '', text) {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function button(text, onClick) {
        const control = element('button', 'rw-ui', text);
        control.type = 'button';
        control.addEventListener('click', onClick);
        return control;
    }

    function createDetails(title, className = '', open = false) {
        const block = element('details', className);
        block.open = open;
        block.appendChild(element('summary', '', title));
        return block;
    }

    function appendRow(parent, name, value) {
        const row = element('div', 'effect-setting');
        row.append(
            element('span', '', label(name)),
            element('span', '', format(value))
        );
        parent.appendChild(row);
    }

    function appendRows(parent, values) {
        for (const [name, value] of Object.entries(values)) {
            appendRow(parent, name, value);
        }
    }

    function isolateMapEvents(node) {
        L.DomEvent.disableClickPropagation(node);
        L.DomEvent.disableScrollPropagation(node);
    }

    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
    }

    function makeDraggable(handle, start, move, finish = () => {}) {
        handle.classList.add('effects-drag-handle');

        let suppressClick = false;
        handle.addEventListener('click', event => {
            if (suppressClick) {
                stopEvent(event);
            }
        }, true);

        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) {
                return;
            }
            stopEvent(event);
            suppressClick = false;

            const { pointerId, clientX, clientY } = event;
            const initial = start();
            let dragging = false;
            handle.setPointerCapture(pointerId);

            const onMove = moveEvent => {
                if (moveEvent.pointerId !== pointerId) {
                    return;
                }
                const dx = moveEvent.clientX - clientX;
                const dy = moveEvent.clientY - clientY;
                if (!dragging && Math.hypot(dx, dy) < 4) {
                    return;
                }
                dragging = true;
                suppressClick = true;
                handle.classList.add('effects-dragging');
                move(initial, dx, dy);
                stopEvent(moveEvent);
            };

            const onEnd = endEvent => {
                if (endEvent.pointerId !== pointerId) {
                    return;
                }
                window.removeEventListener('pointermove', onMove, true);
                window.removeEventListener('pointerup', onEnd, true);
                window.removeEventListener('pointercancel', onEnd, true);
                if (handle.hasPointerCapture(pointerId)) {
                    handle.releasePointerCapture(pointerId);
                }
                handle.classList.remove('effects-dragging');
                if (dragging) {
                    finish();
                }
                // The click following pointerup must not collapse a dragged card.
                setTimeout(() => {
                    suppressClick = false;
                }, 0);
            };

            window.addEventListener('pointermove', onMove, { capture: true, passive: false });
            window.addEventListener('pointerup', onEnd, true);
            window.addEventListener('pointercancel', onEnd, true);
        });
    }

    function positionInspector(left, top) {
        const bounds = panel.getBoundingClientRect();
        panel.style.left = Math.max(0, Math.min(left, window.innerWidth - bounds.width)) + 'px';
        panel.style.top = Math.max(0, Math.min(top, window.innerHeight - 40)) + 'px';
        panel.style.bottom = 'auto';
    }

    function items() {
        return [
            ...entry.objects.map(record => ({
                key: record.object_type,
                type: label(record.object_type),
                title: label(record.object_type) + ' #' + record.object_index,
                category: 'object',
                record,
            })),
            ...(entry.sounds || []).map(record => ({
                key: 'sound:' + record.sound_type,
                type: label(record.sound_type) + ' Sound',
                title: label(record.sound_type) + ' Sound #' + record.sound_index + ' · ' + record.sample,
                category: 'sound',
                spatial: record.sound_type === 'SPOT',
                record,
            })),
            ...(entry.triggers || []).map(record => ({
                key: 'trigger:' + record.trigger_type + ':' + (record.event_type || 'NONE'),
                type: label(record.trigger_type) + ' Trigger · ' + label(record.event_type || 'No Event'),
                title: label(record.trigger_type) + ' Trigger #' + record.trigger_index + ' · ' +
                    label(record.event_type || 'No Event') + (record.ev_song_name ? ' · ' + record.ev_song_name : ''),
                category: 'trigger',
                spatial: record.trigger_type === 'SPOT',
                record,
            })),
            ...entry.effects.map(record => ({
                key: 'effect:' + record.effect_type,
                type: 'Room Effect · ' + label(record.effect_type),
                title: label(record.effect_type),
                category: 'effect',
                record,
            })),
        ];
    }

    function visibleItems() {
        return items().filter(item =>
            !hiddenTypes.has(item.key) &&
            (!filter || (item.type + ' ' + item.title).toLowerCase().includes(filter))
        );
    }

    function drawMarker(point, radius, style = geometryStyle) {
        L.circleMarker(point, { ...style, radius, fillOpacity: 1 }).addTo(layer);
    }

    function drawPoint(point, title, style = geometryStyle) {
        drawMarker(point, 4, style);
        L.marker(point, {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
                className: 'effect-point-label',
                html: element('span', '', title),
                iconSize: null,
                iconAnchor: [-7, 20],
            }),
        }).addTo(layer);
    }

    function addCard(anchor, card, point, identity, style = geometryStyle) {
        const { name, room_origin } = selected.feature.properties;
        const key = JSON.stringify([selectionContext.slugcat, name, room_origin, identity]);
        const offset = cardOffsets.get(key);
        if (offset) {
            anchor = L.latLng(point.lat + offset.lat, point.lng + offset.lng);
        }

        const connector = L.polyline([point, anchor], style).addTo(layer);
        const marker = L.marker(anchor, {
            icon: L.divIcon({
                className: 'effect-card-anchor',
                html: card,
                iconSize: [230, 0],
                iconAnchor: [0, 0],
            }),
            keyboard: false,
            bubblingMouseEvents: false,
        });
        marker.on('add', () => isolateMapEvents(marker.getElement()));
        marker.on('move', () => connector.setLatLngs([point, marker.getLatLng()]));
        makeDraggable(
            card.querySelector('summary'),
            () => map.latLngToContainerPoint(marker.getLatLng()),
            (initial, dx, dy) => marker.setLatLng(map.containerPointToLatLng(initial.add([dx, dy]))),
            () => {
                const position = marker.getLatLng();
                cardOffsets.set(key, {
                    lat: position.lat - point.lat,
                    lng: position.lng - point.lng,
                });
            }
        );
        marker.addTo(layer);
    }

    function createRecordDetails(item, className, open) {
        const block = createDetails(item.title, className, open);
        block.dataset.effectType = item.key;
        return block;
    }

    function updateVisibleDetails(visible) {
        const count = panel.querySelector('.effects-visible-count');
        if (count) {
            count.textContent = visible.length + ' of ' + items().length + ' entries shown';
        }
        const container = panel.querySelector('.effects-room-details');
        if (!container) {
            return;
        }
        container.replaceChildren();

        for (const item of visible.filter(item => item.category !== 'object' || !hasRoomOrigin())) {
            const block = createRecordDetails(item, 'effect-record effect-record-' + item.category, !item.spatial);
            if (!item.spatial) {
                const notes = {
                    sound: 'Room-wide sound; no point position.',
                    trigger: 'Condition-based trigger; no spatial zone.',
                };
                if (notes[item.category]) {
                    block.appendChild(element('p', 'effects-note', notes[item.category]));
                }
            }
            appendRows(block, item.record);
            if (item.category === 'effect') {
                appendRow(block, 'percent', format(item.record.amount * 100) + '%');
            }
            container.appendChild(block);
        }
        if (!visible.length) {
            container.appendChild(element('p', '', 'No effects match the current visibility and search filters.'));
        }
    }

    function drawSpatialRecord(item, world) {
        const { record, category } = item;
        const trigger = category === 'trigger';
        const x = trigger ? record.spot_pos_x : record.pos_x;
        const y = trigger ? record.spot_pos_y : record.pos_y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return;
        }

        const hx = (trigger ? record.spot_rad_handle_x : record.rad_handle_x) || 0;
        const hy = (trigger ? record.spot_rad_handle_y : record.rad_handle_y) || 0;
        const radius = trigger ? record.spot_rad : record.rad;
        const style = { ...geometryStyle, color: trigger ? '#efb96b' : '#7bdbe8' };
        const point = world(x, y);
        if (Number.isFinite(radius) && radius >= 0) {
            L.circle(point, { ...style, radius }).addTo(layer);
        }
        if (hx || hy) {
            const handle = world(x + hx, y + hy);
            L.polyline([point, handle], style).addTo(layer);
            drawMarker(handle, 3, style);
        }
        drawPoint(point, item.title, style);

        const card = createRecordDetails(item, 'effect-card effect-card-' + category, expanded);
        appendRows(card, record);
        // Sound/trigger panel coordinates describe editor UI, not a world point.
        const anchor = world(x + 50, y - 50);
        const identity = category + ':' + (trigger ? record.trigger_index : record.sound_index);
        addCard(anchor, card, point, identity, style);
    }

    function objectLayout(object, world) {
        const { pos_x: x, pos_y: y } = object;
        const point = world(x, y);
        const hx = object.data_handle_x || 0;
        const hy = object.data_handle_y || 0;
        let px = object.data_panel_x;
        let py = object.data_panel_y;
        let quad = null;

        // Raw LightBeam data stores three relative corners, then the panel offset.
        if (object.object_type === 'LIGHT_BEAM' && object.data_raw) {
            const raw = object.data_raw.split('~').slice(0, 8).map(Number);
            if (raw.length === 8 && raw.every(Number.isFinite)) {
                quad = [
                    point,
                    world(x + raw[0], y + raw[1]),
                    world(x + raw[2], y + raw[3]),
                    world(x + raw[4], y + raw[5]),
                ];
                px = raw[6];
                py = raw[7];
            }
        } else if (object.data_handle2_x != null && object.data_handle3_x != null) {
            quad = [
                point,
                world(x + hx, y + hy),
                world(x + object.data_handle2_x, y + object.data_handle2_y),
                world(x + object.data_handle3_x, y + object.data_handle3_y),
            ];
        }

        return {
            point,
            quad,
            handle: hx || hy ? world(x + hx, y + hy) : null,
            radius: Math.hypot(hx, hy),
            anchor: px || py ? world(x + (px || 0), y + (py || 0)) : point,
        };
    }

    function drawObject(item, world) {
        const object = item.record;
        const { point, quad, handle, radius, anchor } = objectLayout(object, world);
        if (quad) {
            L.polygon(quad, geometryStyle).addTo(layer);
            quad.slice(1).forEach(corner => drawMarker(corner, 3));
        } else if (handle) {
            if (radiusClasses.has(object.data_class)) {
                L.circle(point, { ...geometryStyle, radius }).addTo(layer);
            }
            L.polyline([point, handle], geometryStyle).addTo(layer);
        }

        const className = 'effect-card' + (object.active ? '' : ' effect-inactive');
        const card = createDetails(item.title, className, expanded);
        appendRow(card, 'position', format(object.pos_x) + ', ' + format(object.pos_y));
        appendRow(card, 'active', object.active ? 'Yes' : 'No');
        if (object.deactivated_by_warp_filter) {
            appendRow(card, 'warp filter', 'Deactivated');
        }
        const settings = Object.fromEntries(Object.entries(object).filter(([key]) =>
            key.startsWith('data_') && key !== 'data_class'
        ));
        appendRows(card, settings);
        addCard(anchor, card, point, 'object:' + object.object_index);
        drawPoint(point, item.type);
    }

    function drawObjects() {
        layer.clearLayers();
        if (!selected || !entry) {
            return;
        }
        const visible = visibleItems();
        updateVisibleDetails(visible);
        if (!hasRoomOrigin()) {
            return;
        }
        const origin = selected.feature.properties.room_origin;
        const world = (x, y) => L.latLng(origin[1] + y, origin[0] + x);
        visible.filter(item => item.spatial).forEach(item => drawSpatialRecord(item, world));
        visible.filter(item => item.category === 'object').forEach(item => drawObject(item, world));
    }

    function createInspectorHeader() {
        const header = element('header', 'effects-header');
        header.append(
            element('div', 'effects-heading', 'Room effects'),
            element('h2', '', selected.feature.properties.name)
        );
        makeDraggable(
            header,
            () => panel.getBoundingClientRect(),
            (initial, dx, dy) => positionInspector(initial.left + dx, initial.top + dy)
        );
        return header;
    }

    function createSearchControls() {
        const controls = element('div', 'effects-controls');
        const search = element('input');
        search.type = 'search';
        search.placeholder = 'Find effects, sounds, songs or triggers';
        search.value = filter;
        search.setAttribute('aria-label', 'Filter effects, sounds and triggers by name');
        search.addEventListener('input', () => {
            filter = search.value.trim().toLowerCase();
            drawObjects();
        });

        const toggleText = () => expanded ? 'Collapse panels' : 'Expand panels';
        const toggle = button(toggleText(), () => {
            expanded = !expanded;
            toggle.textContent = toggleText();
            drawObjects();
        });
        controls.append(search, toggle);
        return controls;
    }

    function effectTypes() {
        const types = new Map();
        for (const item of items()) {
            const type = types.get(item.key) || { key: item.key, name: item.type, count: 0 };
            type.count++;
            types.set(item.key, type);
        }
        return [...types.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    function createTypeOption(type) {
        const option = element('label', 'effects-type-option');
        const input = element('input', 'rw-ui rw-ui-ckb');
        input.type = 'checkbox';
        input.value = type.key;
        input.checked = !hiddenTypes.has(type.key);
        input.addEventListener('change', () => setTypeVisibility([type.key], input.checked));
        option.append(
            input,
            element('span', '', type.name),
            element('span', 'effects-type-count', type.count)
        );
        return option;
    }

    function createTypeFilters() {
        const visibility = element('fieldset', 'effects-type-filters');
        const types = effectTypes();
        if (!types.length) {
            return visibility;
        }
        const list = element('div', 'effects-type-list');
        list.append(...types.map(createTypeOption));

        const toggleAll = visible => {
            list.querySelectorAll('input').forEach(input => {
                input.checked = visible;
            });
            setTypeVisibility(types.map(type => type.key), visible);
        };
        const actions = element('div', 'effects-controls');
        actions.append(
            button('Show all', () => toggleAll(true)),
            button('Hide all', () => toggleAll(false))
        );
        visibility.append(element('legend', '', 'Visible effect types'), actions, list);
        return visibility;
    }

    function showInspector(message) {
        panel.replaceChildren();
        panel.hidden = !selected || !map.hasLayer(layer);
        if (panel.hidden) {
            return;
        }
        const body = element('div', 'effects-body');
        panel.append(createInspectorHeader(), body);
        if (message) {
            body.appendChild(element('p', '', message));
            return;
        }

        if (!hasRoomOrigin()) {
            body.appendChild(element('p', 'effects-note',
                'Spatial placement is unavailable: this room has no matching terrain reference. Settings are listed below.'));
        }
        body.appendChild(createSearchControls());
        if (items().length) {
            body.appendChild(createTypeFilters());
        }
        const totals = [
            entry.effects.length + ' room-wide effects',
            entry.objects.length + ' objects',
            (entry.sounds || []).length + ' sounds',
            (entry.triggers || []).length + ' triggers',
        ].join(' · ');
        body.append(
            element('p', 'effects-visible-count'),
            element('p', 'effects-totals', totals),
            element('div', 'effects-room-details')
        );
        updateVisibleDetails(visibleItems());

        const settings = createDetails('Room settings');
        appendRows(settings, entry.settings);
        body.appendChild(settings);
    }

    function loadJSON(filename, allowMissing = false) {
        if (!cache.has(filename)) {
            const request = fetch('room-effects/' + filename.split('/').map(encodeURIComponent).join('/') + '.json')
                .then(response => {
                    if (allowMissing && response.status === 404) {
                        return { rooms: {} };
                    }
                    if (!response.ok) {
                        const prefix = filename === 'index' ? 'Room index: ' : '';
                        throw new Error(prefix + 'HTTP ' + response.status);
                    }
                    return response.json();
                })
                .catch(error => {
                    cache.delete(filename);
                    throw error;
                });
            cache.set(filename, request);
        }
        return cache.get(filename);
    }

    async function loadRoomVariants(region, name, current) {
        let data = await loadJSON(region, true);
        if (current !== version) {
            return;
        }
        if (!data.rooms[name]) {
            const index = await loadJSON('index');
            if (current !== version) {
                return;
            }
            if (index[name] && index[name] !== region) {
                data = await loadJSON(index[name]);
            }
        }
        return data.rooms[name];
    }

    function hasRoomOrigin() {
        const origin = selected?.feature.properties.room_origin;
        return Array.isArray(origin) && origin.length === 2 && origin.every(Number.isFinite);
    }

    function geometryStamp(lines) {
        const text = lines.map(line =>
            line.map(([x, y]) => x.toFixed(3) + ',' + y.toFixed(3)).join(';')
        ).join('|');
        let value = 2166136261;
        for (const character of text) {
            value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
        }
        return value.toString(16).padStart(8, '0');
    }

    async function prepareRooms(data, slugcat, region) {
        let coordinates;
        try {
            coordinates = await loadJSON('coordinates/' + slugcat + '/' + region, true);
        } catch (error) {
            console.warn('Room effect coordinates:', error);
            coordinates = { rooms: {} };
        }
        const geometry = new Map(data.geo_features.map(feature => [
            feature.properties.room, feature.geometry.coordinates,
        ]));
        for (const feature of data.room_features) {
            const properties = feature.properties;
            const reference = coordinates.rooms[properties.name];
            const lines = geometry.get(properties.name);
            delete properties.room_origin;
            if (reference && lines && reference.geometryStamp === geometryStamp(lines)) {
                properties.room_origin = reference.origin;
            }
        }
    }

    async function select(roomLayer, regionName, context = {}) {
        const current = ++version;
        selected = roomLayer;
        selectionContext = context;
        entry = null;
        layer.clearLayers();
        if (!selected) {
            panel.hidden = true;
            return;
        }
        showInspector('Loading room effects…');

        try {
            const name = selected.feature.properties.name.toUpperCase();
            const variants = await loadRoomVariants(regionName.toUpperCase(), name, current);
            if (current !== version) {
                return;
            }
            entry = variants && variants[''];
            if (!entry) {
                showInspector('No default room data in the supplied database.');
                return;
            }
            entry = window.roomEffectsCharacter.forCharacter(entry, context.slugcat);
            showInspector();
            drawObjects();
        } catch (error) {
            if (current === version) {
                showInspector('Could not load room effects. Serve the docs folder over HTTP and check the exported JSON files.');
            }
            console.error('Room effects:', error);
        }
    }

    window.addEventListener('resize', () => {
        if (panel.style.top && !panel.hidden) {
            const bounds = panel.getBoundingClientRect();
            positionInspector(bounds.left, bounds.top);
        }
    });

    map.on('overlayremove', event => {
        if (event.layer === layer) {
            panel.hidden = true;
        }
    });

    map.on('overlayadd', event => {
        if (event.layer === layer) {
            showInspector(entry ? null : 'Select a room to inspect its effects.');
        }
    });

    window.roomEffects = { select, prepareRooms };
})();
