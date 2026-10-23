(function () {
    'use strict';

    function createRoomEffects(config) {
        config = config || {};

        const onSelect = config.onSelect || noop;
        const getOffsetContext = config.getOffsetContext || (() => '');
        const shouldDrawSpatial = config.shouldDrawSpatial || (() => true);
        const getWorldOrigin = config.getWorldOrigin || defaultWorldOrigin;
        const getMissingSpatialMessage = config.getMissingSpatialMessage || (() => null);
        const filterEntry = config.filterEntry || ((entry) => entry);
        const pickVariant = config.pickVariant || defaultVariant;

        const cache = new Map();
        const cardOffsets = new Map();
        const autoLayout = new Map();
        const activeCards = new Map();
        const visibilityKey = 'rain-world-map.hidden-effect-types';
        const colorKey = 'rain-world-map.object-colors';
        const geometryStyle = { color: '#fff', weight: 1, opacity: 0.85, fillOpacity: 0, interactive: false };
        const radiusClasses = new Set(['LightSourceData', 'ResizableObjectData', 'InsectGroupData', 'ScavengerOutpostData', 'SnowSourceData', 'OEsphereData', 'CellDistortionData', 'LocalBlizzardData', 'EnergySwirlData', 'SteamPipeData', 'FilterData', 'RippleLevelFilterData', 'PrinceFilterData', 'CollectTokenData', 'AirPocketData', 'WaterCutoffData', 'CustomRotData', 'GeyserData', 'GooDripsData', 'LobeTreeData', 'MudPitData', 'RainbowData', 'RainbowNoFadeData', 'ReliableIggyDirectionData', 'KarmaFlowerPatchData', 'WaterCurrentData']);
        const hiddenEffectKeys = new Set(['inherited', 'overwrite', 'effectindex', 'amount']);
        const hiddenSettingKeys = new Set(['mergedtimelines']);
        const hiddenRecordKeys = new Set(['soundindex', 'inherited', 'overwrite', 'isblue', 'isgreen', 'iswhite', 'isred', 'isdev', 'availabletoplayers', 'vertices', 'raw',]);
        const noKeys = new Set();
        const edgePadding = 6;
        const cardGap = 6;
        const dockDistance = 36;
        const expanded = true;
        const hiddenTypes = loadVisibility();
        const obstacleSelectors = [
            '.side-panel',
            '.leaflet-control',
            '.sidebar',
            '#sidebar',
            '.region-panel',
            '#region-panel',
            '#region-select',
        ];

        let selected = null;
        let version = 0;
        let entry = null;
        let cardStack = 0;
        let layerVisible = true;
        let panelsHidden = false;
        let hideToggle = null;
        let typePanel = null;
        let docked = false;
        let autoCollapsed = false;
        let models = [];
        let leaveTimer = null;
        let colorsEnabled = loadColors();

        const layer = L.layerGroup().addTo(map);
        overlays.addOverlay(layer, 'Room Effects');

        const originalAddOverlay = overlays.addOverlay.bind(overlays);
        overlays.addOverlay = function (overlayLayer, name) {
            const result = originalAddOverlay(overlayLayer, name);
            if (typePanel) layoutLayerPanel();
            return result;
        };

        const cardPane = map.createPane('effectCardPane');
        cardPane.style.zIndex = 800;

        const panel = document.createElement('div');
        panel.className = 'side-panel effects-inspector rw-text';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', 'Room effects');
        panel.hidden = true;
        document.body.appendChild(panel);
        isolateMapEvents(panel);

        function loadVisibility() {
            try {
                const saved = JSON.parse(localStorage.getItem(visibilityKey) || '[]');
                if (Array.isArray(saved)) return new Set(saved.filter(isString));
            } catch (error) {
                return new Set();
            }
            return new Set();
        }

        function loadColors() {
            try {
                return localStorage.getItem(colorKey) !== 'off';
            } catch (error) {
                return true;
            }
        }

        function saveColors() {
            try {
                localStorage.setItem(colorKey, colorsEnabled ? 'on' : 'off');
            }
            catch (error) {
                console.warn('Room effects: storage is not available.');
            }
        }

        function isString(value) {
            return typeof value === 'string';
        }

        function noop() {
            return undefined;
        }

        function clamp(value, min, max) {
            return Math.max(min, Math.min(value, max));
        }

        function setupHideToggle() {
            hideToggle = button('Hide panels', onHideToggleClick);
            hideToggle.className = 'rw-ui effects-hide-toggle';
            hideToggle.hidden = true;
            isolateMapEvents(hideToggle);
            document.body.appendChild(hideToggle);
        }

        function onHideToggleClick() {
            setPanelsHidden(!panelsHidden);
        }

        function updateHideToggle() {
            if (!hideToggle) return;
            hideToggle.hidden = !selected || !layerVisible;
            hideToggle.textContent = panelsHidden ? 'Show panels' : 'Hide panels';
        }

        function shouldShowInspector() {
            return !!selected && layerVisible;
        }

        function setPanelsHidden(hide) {
            panelsHidden = hide;
            updateHideToggle();
            clearTimeout(leaveTimer);
            const container = map.getContainer();
            if (hide && activeCards.size) {
                container.classList.add('effects-cards-leaving');
                leaveTimer = setTimeout(finishHide, 280);
                return;
            }
            container.classList.remove('effects-cards-leaving');
            if (selected && entry && layerVisible) drawObjects();
        }

        function finishHide() {
            map.getContainer().classList.remove('effects-cards-leaving');
            if (selected && entry && layerVisible) drawObjects();
        }

        function setTypeVisibility(types, visible) {
            for (const type of types) {
                if (visible) hiddenTypes.delete(type); else hiddenTypes.add(type);
            }
            try {
                localStorage.setItem(visibilityKey, JSON.stringify([...hiddenTypes]));
            }
            catch (error) {
                console.warn('Room effects: storage is not available.');
            }
            syncVisibility();
            syncTypeToggleStates();
        }

        function syncTypeToggleStates() {
            if (!typePanel) return;
            const toggles = typePanel.querySelectorAll('[data-effect-type]');
            let allShown = toggles.length > 0;
            let allHidden = toggles.length > 0;
            for (const toggle of toggles) {
                const visible = !hiddenTypes.has(toggle.dataset.effectType);
                toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
                if (!visible) allShown = false;
                if (visible) allHidden = false;
            }
            const showAll = typePanel.querySelector('[data-action="show-all"]');
            const hideAll = typePanel.querySelector('[data-action="hide-all"]');
            if (showAll && hideAll) {
                showAll.setAttribute('aria-pressed', allShown ? 'true' : 'false');
                hideAll.setAttribute('aria-pressed', allHidden ? 'true' : 'false');
            }
        }

        function isRoomEffectsLabel(item) {
            return item.textContent.includes('Room Effects');
        }

        function findOverlaysList() {
            const container = overlays.getContainer && overlays.getContainer();
            if (!container) return null;
            const found = [...container.querySelectorAll('label')].find(isRoomEffectsLabel);
            return found ? found.parentElement : null;
        }

        function layoutLayerPanel() {
            const list = findOverlaysList();
            if (!list || !typePanel) return;
            const found = [...list.querySelectorAll('label')].find(isRoomEffectsLabel);
            if (found) list.appendChild(found);
            list.appendChild(typePanel);
        }

        function setupLayerPanel() {
            const list = findOverlaysList();
            if (!list) return;
            typePanel = element('div', 'effects-type-panel');
            isolateMapEvents(typePanel);
            list.appendChild(typePanel);
            layoutLayerPanel();
            updateTypePanelVisibility();
            rebuildTypeToggles();
        }

        function updateTypePanelVisibility() {
            if (typePanel) typePanel.hidden = !layerVisible;
        }

        function label(value) {
            let text = String(value);
            if (/^[A-Z0-9_]+$/.test(text)) text = text.toLowerCase();
            text = text.replace(/^data_/, '');
            text = text.replace(/_/g, ' ');
            text = text.replace(/([a-z])([A-Z])/g, '$1 $2');
            return text.replace(/\b\w/g, upperCase);
        }

        function upperCase(character) {
            return character.toUpperCase();
        }

        function format(value) {
            if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
            if (value !== null && typeof value === 'object') return JSON.stringify(value);
            return String(value);
        }

        function element(tag, className = '', text) {
            const node = document.createElement(tag);
            node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        }

        function button(text, onClick) {
            const control = element('button', 'rw-ui', text);
            control.type = 'button';
            control.addEventListener('click', onClick);
            return control;
        }

        // plain <details>: content lives directly inside the element
        function createDetails(title, className = '', open = false) {
            const block = element('details', className);
            block.open = open;
            block.appendChild(element('summary', '', title));
            block.content = block;
            return block;
        }

        // effect cards: same grid collapse pattern as the inspector
        function createCardDetails(title, className = '', open = false) {
            const block = element('details', className);
            block.open = open;
            block.appendChild(element('summary', '', title));
            const collapse = element('div', 'effect-card-collapse');
            const scroll = element('div', 'effect-card-scroll');
            collapse.appendChild(scroll);
            block.appendChild(collapse);
            block.content = scroll;
            return block;
        }

        function appendRow(parent, name, value) {
            const row = element('div', 'effect-setting');
            row.append(element('span', '', label(name)), element('span', '', format(value)));
            parent.appendChild(row);
        }

        function normalizeKey(name) {
            return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
        }

        function isInternalOffsetKey(name) {
            return /handle|panel/i.test(name) || /(^|_)pos_?[xy]$/i.test(name) || /^position$/i.test(name);
        }

        function appendRows(parent, values, hiddenKeys = noKeys) {
            for (const [name, value] of Object.entries(values)) {
                if (isInternalOffsetKey(name)) continue;
                if (hiddenKeys.has(normalizeKey(name))) continue;
                if (hiddenKeys.has(normalizeKey(name.replace(/^data_/, '')))) continue;
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

        function makeDraggable(handle, start, move, finish = noop, onDragStart = noop) {
            handle.classList.add('effects-drag-handle');
            let suppressClick = false;

            function onClickCapture(event) {
                if (suppressClick) stopEvent(event);
            }

            function onPointerDown(event) {
                if (event.button !== 0) return;
                stopEvent(event);
                suppressClick = false;
                const { pointerId, clientX, clientY } = event;
                const initial = start(event);
                let dragging = false;
                handle.setPointerCapture(pointerId);

                function onMove(moveEvent) {
                    if (moveEvent.pointerId !== pointerId) return;
                    const dx = moveEvent.clientX - clientX;
                    const dy = moveEvent.clientY - clientY;
                    if (!dragging && Math.hypot(dx, dy) < 4) return;
                    if (!dragging) { dragging = true; onDragStart(); }
                    suppressClick = true;
                    handle.classList.add('effects-dragging');
                    move(initial, dx, dy, moveEvent);
                    stopEvent(moveEvent);
                }

                function releaseClick() {
                    suppressClick = false;
                }

                function onEnd(endEvent) {
                    if (endEvent.pointerId !== pointerId) return;
                    window.removeEventListener('pointermove', onMove, true);
                    window.removeEventListener('pointerup', onEnd, true);
                    window.removeEventListener('pointercancel', onEnd, true);
                    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
                    handle.classList.remove('effects-dragging');
                    if (dragging) finish();
                    setTimeout(releaseClick, 0);
                }

                window.addEventListener('pointermove', onMove, { capture: true, passive: false });
                window.addEventListener('pointerup', onEnd, true);
                window.addEventListener('pointercancel', onEnd, true);
            }

            handle.addEventListener('click', onClickCapture, true);
            handle.addEventListener('pointerdown', onPointerDown);
        }

        function setCollapsed(collapsed) {
            panel.classList.toggle('effects-collapsed', collapsed);
            const header = panel.querySelector('.effects-header');
            if (header) header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        }

        function dockPanel() {
            docked = true;
            autoCollapsed = !panel.classList.contains('effects-collapsed');
            if (autoCollapsed) setCollapsed(true);
            panel.classList.add('effects-docked');
            panel.style.top = 'auto';
            panel.style.bottom = '0px';
        }

        function undockPanel() {
            docked = false;
            panel.classList.remove('effects-docked');
            panel.style.bottom = 'auto';
            if (autoCollapsed) {
                autoCollapsed = false;
                setCollapsed(false);
            }
        }

        function positionInspector(left, top) {
            const bounds = panel.getBoundingClientRect();
            panel.style.left = clamp(left, 0, window.innerWidth - bounds.width) + 'px';
            if (!docked) panel.style.top = clamp(top, 0, window.innerHeight - 60) + 'px';
        }

        function triggerTypeName(record) {
            const eventType = record.event_type;
            if (eventType && !/^none$/i.test(String(eventType))) return label(eventType);
            return label(record.trigger_type) + ' Trigger';
        }
        function defaultVariant(variants) {
            return variants[''];
        }

        function normalizeObject(object, index) {
            const data = object.data;
            if (!data || typeof data !== 'object') return object;
            const flat = {
                object_type: object.type,
                object_index: object.object_index ?? index,
                pos_x: object.posX,
                pos_y: object.posY,
                active: object.active !== false,
                deactivated_by_warp_filter: Boolean(object.deactivatedByWarpFilter),
                data_class: data.kind,
            };
            for (const [key, value] of Object.entries(data)) {
                if (key !== 'kind') flat['data_' + key] = value;
            }
            flat.data_handle_x = data.handlePosX;
            flat.data_handle_y = data.handlePosY;
            flat.data_panel_x = data.panelPosX;
            flat.data_panel_y = data.panelPosY;
            if (data.handle0X !== undefined) {
                flat.quad_offsets = [[data.handle0X, data.handle0Y], [data.handle1X, data.handle1Y], [data.handle2X, data.handle2Y]];
            }
            if (object.unrecognizedAttributes && object.unrecognizedAttributes.length) {
                flat.data_unrecognizedAttributes = object.unrecognizedAttributes;
            }
            return flat;
        }

        function normalizeEntry(source) {
            const objects = (source.objects || []).map(normalizeObject);
            const resolved = Array.isArray(source.timelines) || (source.objects || []).some(object => object.data);
            return { ...source, objects, timelineResolved: resolved };
        }

        function objectItem(record) {
            return { key: record.object_type, type: label(record.object_type), title: label(record.object_type) + ' #' + record.object_index, category: 'object', record };
        }
        function soundItem(record) {
            const title = label(record.sound_type) + ' Sound #' + record.sound_index + ' - ' + record.sample;
            return { key: 'sound:' + record.sound_type, type: label(record.sound_type) + ' Sound', title, category: 'sound', spatial: record.sound_type === 'SPOT', record };
        }
        function triggerItem(record) {
            const song = record.ev_song_name ? ' - ' + record.ev_song_name : '';
            const title = label(record.trigger_type) + ' Trigger #' + record.trigger_index + ' - ' + label(record.event_type || 'No Event') + song;
            const key = 'trigger:' + record.trigger_type + ':' + (record.event_type || 'NONE');
            return { key, type: triggerTypeName(record), title, category: 'trigger', spatial: record.trigger_type === 'SPOT', record };
        }
        function effectItem(record) {
            return { key: 'effect:' + record.effect_type, type: 'Room Effect - ' + label(record.effect_type), title: label(record.effect_type), category: 'effect', record };
        }
        function items() {
            const objects = entry.objects.map(objectItem);
            const sounds = (entry.sounds || []).map(soundItem);
            const triggers = (entry.triggers || []).map(triggerItem);
            const effects = entry.effects.map(effectItem);
            return [...objects, ...sounds, ...triggers, ...effects];
        }
        function isShownItem(item) {
            return item.category === 'effect' || !hiddenTypes.has(item.key);
        }

        function visibleItems() {
            return items().filter(isShownItem);
        }

        function isEffectItem(item) {
            return item.category === 'effect';
        }

        function isDataEntry(pair) {
            return pair[0].startsWith('data_') && pair[0] !== 'data_class';
        }

        function isSpatialItem(item) {
            return item.category !== 'effect' && (item.category === 'object' || item.spatial);
        }

        function isObjectItem(item) {
            return item.category === 'object';
        }

        function isSpatialItemNotObject(item) {
            return isSpatialItem(item) && !isObjectItem(item);
        }

        function drawMarker(point, radius, style = geometryStyle, target = layer) {
            L.circleMarker(point, { ...style, radius, fillOpacity: 1 }).addTo(target);
        }

        function drawPoint(point, title, style = geometryStyle, target = layer) {
            drawMarker(point, 4, style, target);
            const iconOptions = { className: 'effect-point-label', html: element('span', '', title), iconSize: null, iconAnchor: [-7, 20] };
            const markerOptions = { interactive: false, keyboard: false, icon: L.divIcon(iconOptions) };
            L.marker(point, markerOptions).addTo(target);
        }

        function createRecordDetails(item, className, open) {
            const isCard = className.includes('effect-card');
            const block = isCard
                ? createCardDetails(item.title, className, open)
                : createDetails(item.title, className, open);
            block.dataset.effectType = item.key;
            return block;
        }

        function updateVisibleDetails(visible) {
            const container = panel.querySelector('.effects-room-details');
            if (!container) return;
            container.replaceChildren();
            const listed = visible.filter(isEffectItem);
            for (const item of listed) {
                const block = createRecordDetails(item, 'effect-record effect-record-' + item.category, true);
                appendRows(block.content, item.record, hiddenEffectKeys);
                if (typeof item.record.amount === 'number') {
                    appendRow(block.content, 'percent', format(Math.round(item.record.amount * 1000) / 10) + '%');
                }
                container.appendChild(block);
            }
            if (!listed.length) {
                container.appendChild(element('p', '', 'No room effects match the current visibility filters.'));
            }
        }

        function hasMeaningfulHandle3(object) {
            const x = object.data_handle3_x;
            const y = object.data_handle3_y;
            if (x == null && y == null) return false;
            if ((x == null || x === 0) && (y == null || y === 0)) return false;
            return true;
        }

        function lightBeamQuad(object, world, point) {
            const { pos_x: x, pos_y: y } = object;
            const raw = object.data_raw.split('~').slice(0, 8).map(Number);
            if (raw.length !== 8 || !raw.every(Number.isFinite)) return null;
            return [point, world(x + raw[0], y + raw[1]), world(x + raw[2], y + raw[3]), world(x + raw[4], y + raw[5])];
        }

        function objectLayout(object, world) {
            const { pos_x: x, pos_y: y } = object;
            const point = world(x, y);
            const hx = object.data_handle_x || 0;
            const hy = object.data_handle_y || 0;
            let px = object.data_panel_x;
            let py = object.data_panel_y;
            let quad = null;

            if (object.quad_offsets) {
                const corners = object.quad_offsets.map(offset => world(x + offset[0], y + offset[1]));
                quad = [point, ...corners];
            } else if (object.object_type === 'LIGHT_BEAM' && object.data_raw) {
                quad = lightBeamQuad(object, world, point);
                if (quad) {
                    const raw = object.data_raw.split('~').map(Number);
                    px = raw[6]; py = raw[7];
                }
            } else if (object.data_handle2_x != null && hasMeaningfulHandle3(object)) {
                const second = world(x + object.data_handle2_x, y + object.data_handle2_y);
                const third = world(x + object.data_handle3_x, y + object.data_handle3_y);
                quad = [point, world(x + hx, y + hy), second, third];
            } else if (object.data_handle2_x != null && !radiusClasses.has(object.data_class)) {
                const cx = object.data_handle2_x;
                const cy = object.data_handle2_y || 0;
                const len2 = cx * cx + cy * cy;
                let d3x = hx; let d3y = hy;
                if (len2 > 1e-6) {
                    const t = (hx * cx + hy * cy) / len2;
                    d3x = 2 * t * cx - hx;
                    d3y = 2 * t * cy - hy;
                }
                quad = [point, world(x + hx, y + hy), world(x + cx, y + cy), world(x + d3x, y + d3y)];
            }

            return { point, quad, handle: hx || hy ? world(x + hx, y + hy) : null, radius: Math.hypot(hx, hy), anchor: px || py ? world(x + (px || 0), y + (py || 0)) : point };
        }

        function objectHue(object) {
            const x = Math.round((object.pos_x || 0) * 100) | 0;
            const y = Math.round((object.pos_y || 0) * 100) | 0;
            const i = (object.object_index || 0) | 0;
            let h = 2166136261 >>> 0;
            for (const n of [x, y, i]) { h ^= n; h = Math.imul(h, 16777619); }
            h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
            h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
            h ^= h >>> 16;
            return (h >>> 0) % 360;
        }

        function objectStyle(object) {
            if (!colorsEnabled) return { ...geometryStyle };
            return { ...geometryStyle, color: 'hsl(' + objectHue(object) + ', 70%, 62%)' };
        }

        function createSpatialModel(item, world) {
            const { record, category } = item;
            const trigger = category === 'trigger';
            const x = trigger ? record.spot_pos_x : record.pos_x;
            const y = trigger ? record.spot_pos_y : record.pos_y;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

            const hx = (trigger ? record.spot_rad_handle_x : record.rad_handle_x) || 0;
            const hy = (trigger ? record.spot_rad_handle_y : record.rad_handle_y) || 0;
            const radius = trigger ? record.spot_rad : record.rad;
            const style = { ...geometryStyle, color: trigger ? '#efb96b' : '#7bdbe8' };
            const point = world(x, y);
            const handle = hx || hy ? world(x + hx, y + hy) : null;
            const hasRadius = Number.isFinite(radius) && radius >= 0;
            const shapes = [{ kind: 'dot', point }];
            if (hasRadius && radius > 0) shapes.push({ kind: 'circle', center: point, radius });
            if (handle) shapes.push({ kind: 'line', points: [point, handle] });
            if (handle) shapes.push({ kind: 'dot', point: handle });

            const group = L.layerGroup();

            function draw() {
                if (hasRadius) {
                    const options = { ...style, radius, fillColor: style.color, fillOpacity: 0.16 };
                    L.circle(point, options).addTo(group);
                }
                if (handle) {
                    L.polyline([point, handle], style).addTo(group);
                    drawMarker(handle, 3, style, group);
                }
                drawPoint(point, item.title, style, group);
            }

            const card = createRecordDetails(item, 'effect-card effect-card-' + category, expanded);
            appendRows(card.content, record, hiddenRecordKeys);
            const identity = category + ':' + (trigger ? record.trigger_index : record.sound_index);
            return { point, card, identity, style, item, shapes, labelText: item.title, draw, group };
        }

        function createObjectModel(item, world) {
            const object = item.record;
            const layout = objectLayout(object, world);
            const style = objectStyle(object);
            const shapes = [{ kind: 'dot', point: layout.point }];

            if (layout.quad) {
                shapes.push({ kind: 'poly', points: layout.quad });
                for (const corner of layout.quad.slice(1)) shapes.push({ kind: 'dot', point: corner });
            } else if (layout.handle) {
                if (radiusClasses.has(object.data_class) && layout.radius > 0) {
                    shapes.push({ kind: 'circle', center: layout.point, radius: layout.radius });
                }
                shapes.push({ kind: 'line', points: [layout.point, layout.handle] });
            }

            const group = L.layerGroup();

            function draw() {
                const fill = { ...style, fillColor: style.color, fillOpacity: 0.16 };
                if (layout.quad) {
                    L.polygon(layout.quad, fill).addTo(group);
                    for (const corner of layout.quad.slice(1)) drawMarker(corner, 3, style, group);
                } else if (layout.handle) {
                    if (radiusClasses.has(object.data_class)) {
                        L.circle(layout.point, { ...fill, radius: layout.radius }).addTo(group);
                    }
                    L.polyline([layout.point, layout.handle], style).addTo(group);
                }
                drawPoint(layout.point, item.type, style, group);
            }

            const className = 'effect-card' + (object.active ? '' : ' effect-inactive');
            const card = createCardDetails(item.title, className, expanded);
            if (colorsEnabled) card.style.setProperty('--effect-object-color', style.color);
            appendRow(card.content, 'active', object.active ? 'Yes' : 'No');
            if (object.deactivated_by_warp_filter) appendRow(card.content, 'warp filter', 'Deactivated');
            const settings = Object.fromEntries(Object.entries(object).filter(isDataEntry));
            appendRows(card.content, settings, hiddenRecordKeys);

            return { point: layout.point, card, identity: 'object:' + object.object_index, style, item, shapes, labelText: item.type, draw, group };
        }

        function defaultWorldOrigin(roomLayer) {
            const bounds = roomLayer.getBounds();
            return roomLayer.feature.properties.room_origin || [bounds.getWest() - 17, bounds.getSouth() - 18];
        }

        function drawObjects() {
            layer.clearLayers();
            activeCards.clear();
            models = [];
            if (!selected || !entry) return;

            updateVisibleDetails(visibleItems());
            if (!shouldDrawSpatial(selected)) return;

            const origin = getWorldOrigin(selected);
            const world = (x, y) => L.latLng(origin[1] + y, origin[0] + x);
            const all = items();

            const { name, room_origin: roomOrigin } = selected.feature.properties;
            const sources = [...all.filter(isSpatialItemNotObject), ...all.filter(isObjectItem)];
            for (const item of sources) {
                const model = isObjectItem(item) ? createObjectModel(item, world) : createSpatialModel(item, world);
                if (!model) continue;
                model.visible = !hiddenTypes.has(item.key);
                model.offsetKey = JSON.stringify([getOffsetContext(), name, roomOrigin, model.identity]);
                models.push(model);
            }

            measureCards(models);
            runLayout();

            for (const model of models) {
                if (!model.visible) continue;
                model.draw();
                model.drawn = true;
                model.group.addTo(layer);
                model.onMap = true;
                if (panelsHidden) continue;
                addCard(model);
            }
        }

        // show-only animated visibility sync
        function syncVisibility() {
            if (!selected || !entry || !models.length || panelsHidden) {
                drawObjects();
                return;
            }
            for (const model of models) {
                const shouldShow = !hiddenTypes.has(model.item.key);
                model.visible = shouldShow;
                if (shouldShow) revealModel(model);
                else hideModel(model);
            }
        }

        function prefersReducedMotion() {
            return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        }

        function revealModel(model) {
            if (model.onMap) return;
            if (!model.drawn) {
                model.draw();
                model.drawn = true;
            }
            model.card.open = false;
            model.group.addTo(layer);
            model.onMap = true;
            if (!activeCards.has(model.identity)) addCard(model);
            if (prefersReducedMotion()) {
                model.card.open = true;
                return;
            }
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    if (model.onMap) model.card.open = true;
                });
            });
        }

        function hideModel(model) {
            if (!model.onMap) return;
            removeModel(model);
        }

        function removeModel(model) {
            if (layer.hasLayer(model.group)) layer.removeLayer(model.group);
            model.onMap = false;
        }

        function measureCards(list) {
            if (!list.length) return;
            const root = document.createElement('div');
            root.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;pointer-events:none;';
            document.body.appendChild(root);
            for (const model of list) root.appendChild(model.card);
            for (const model of list) {
                const rect = model.card.getBoundingClientRect();
                model.size = {
                    width: rect.width || 230, height: rect.height || 80
                };
            }
            for (const model of list) root.removeChild(model.card);
            document.body.removeChild(root);
        }

        function rectShape(minX, minY, maxX, maxY) {
            return { kind: 'rect', minX, minY, maxX, maxY, box: { minX, minY, maxX, maxY } };
        }

        function boundsOfPoints(points, pad) {
            const xs = points.map(getX);
            const ys = points.map(getY);
            return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
        }

        function getX(point) {
            return point.x;
        }

        function getY(point) {
            return point.y;
        }

        function toContainer(latlng) {
            return map.latLngToContainerPoint(latlng);
        }

        function convertShape(shape) {
            if (shape.kind === 'dot') {
                const p = toContainer(shape.point);
                return rectShape(p.x - 5, p.y - 5, p.x + 5, p.y + 5);
            }
            if (shape.kind === 'line' || shape.kind === 'poly') {
                const points = shape.points.map(toContainer);
                return { kind: shape.kind, points, box: boundsOfPoints(points, 4) };
            }
            const center = toContainer(shape.center);
            const edge = toContainer(L.latLng(shape.center.lat, shape.center.lng + shape.radius));
            const r = Math.abs(edge.x - center.x);
            return { kind: 'circle', x: center.x, y: center.y, r, box: { minX: center.x - r, minY: center.y - r, maxX: center.x + r, maxY: center.y + r } };
        }

        function buildObstacles() {
            const out = [];
            for (const model of models) {
                for (const shape of model.shapes) out.push(convertShape(shape));
                const point = toContainer(model.point);
                const width = model.labelText.length * 7 + 4;
                out.push(rectShape(point.x + 7, point.y - 20, point.x + 7 + width, point.y - 4));
            }
            return out;
        }

        function collectObstacleNodes() {
            const nodes = new Set(document.querySelectorAll(obstacleSelectors.join(',')));
            if (hideToggle) nodes.add(hideToggle);
            const layersContainer = overlays.getContainer && overlays.getContainer();
            if (layersContainer) nodes.add(layersContainer);
            return nodes;
        }

        function panelRects() {
            const origin = map.getContainer().getBoundingClientRect();
            const rects = [];
            for (const node of collectObstacleNodes()) {
                if (node.hidden) continue;
                const r = node.getBoundingClientRect();
                if (!r.width || !r.height) continue;
                rects.push({
                    minX: r.left - origin.left - cardGap,
                    minY: r.top - origin.top - cardGap,
                    maxX: r.right - origin.left + cardGap,
                    maxY: r.bottom - origin.top + cardGap,
                });
            }
            return rects;
        }

        function overlapArea(a, b) {
            const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
            const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
            return ox > 0 && oy > 0 ? ox * oy : 0;
        }
        function boxesOverlap(a, b) {
            return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
        }
        function segmentHitsRect(a, b, rect) {
            let t0 = 0, t1 = 1;
            const dx = b.x - a.x, dy = b.y - a.y;
            const p = [-dx, dx, -dy, dy];
            const q = [a.x - rect.minX, rect.maxX - a.x, a.y - rect.minY, rect.maxY - a.y];
            for (let i = 0; i < 4; i++) {
                if (p[i] === 0) {
                    if (q[i] < 0) return false;
                    continue;
                }
                const t = q[i] / p[i];
                if (p[i] < 0) {
                    if (t > t1) return false;
                    if (t > t0) t0 = t;
                }
                else {
                    if (t < t0) return false;
                    if (t < t1) t1 = t;
                }
            }
            return true;
        }

        function polygonContains(x, y, shape) {
            const pts = shape.points;
            let inside = false;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                const crosses = (pts[i].y > y) !== (pts[j].y > y);
                if (crosses && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
            }
            return inside;
        }

        function circleContains(x, y, shape) {
            return Math.hypot(x - shape.x, y - shape.y) <= shape.r;
        }

        function sampleFraction(rect, shape, contains) {
            const columns = 6, rows = 4;
            let count = 0;
            for (let i = 0; i < columns; i++) {
                for (let j = 0; j < rows; j++) {
                    const x = rect.minX + ((i + 0.5) / columns) * (rect.maxX - rect.minX);
                    const y = rect.minY + ((j + 0.5) / rows) * (rect.maxY - rect.minY);
                    if (contains(x, y, shape)) count++;
                }
            }
            return count / (columns * rows);
        }
        function polygonTouchesRect(rect, shape) {
            const pts = shape.points;
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                if (a.x >= rect.minX && a.x <= rect.maxX && a.y >= rect.minY && a.y <= rect.maxY) return true;
                if (segmentHitsRect(a, b, rect)) return true;
            }
            return false;
        }

        function rectArea(rect) {
            return (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
        }

        function shapeCoverage(rect, shape) {
            if (!boxesOverlap(rect, shape.box)) return 0;
            if (shape.kind === 'rect') return overlapArea(rect, shape);
            if (shape.kind === 'line') return segmentHitsRect(shape.points[0], shape.points[1], rect) ? 64 : 0;
            if (shape.kind === 'poly') {
                const fraction = sampleFraction(rect, shape, polygonContains);
                if (fraction > 0) return fraction * rectArea(rect);
                return polygonTouchesRect(rect, shape) ? 64 : 0;
            }
            const fraction = sampleFraction(rect, shape, circleContains);
            if (fraction > 0) return fraction * rectArea(rect);
            const nx = clamp(shape.x, rect.minX, rect.maxX);
            const ny = clamp(shape.y, rect.minY, rect.maxY);
            return Math.hypot(nx - shape.x, ny - shape.y) <= shape.r ? 64 : 0;
        }

        function coverageOf(rect, obstacles) {
            let total = 0;
            for (const shape of obstacles) total += shapeCoverage(rect, shape);
            return total;
        }

        function overlapOf(rect, others) {
            let total = 0;
            for (const other of others) total += overlapArea(rect, other);
            return total;
        }

        function scoreRect(rect, point, previous, obstacles, placed, size) {
            const cover = Math.ceil(coverageOf(rect, obstacles) / 8);
            const overlap = Math.ceil(overlapOf(rect, placed) / 16);
            const cx = (rect.minX + rect.maxX) / 2;
            const cy = (rect.minY + rect.maxY) / 2;
            const toObject = Math.hypot(cx - point.x, cy - point.y);
            const edge = Math.min(rect.minX, rect.minY, size.x - rect.maxX, size.y - rect.maxY);
            let soft = toObject + edge * 1.2;
            if (previous) soft += Math.hypot(rect.minX - previous.x, rect.minY - previous.y) * 0.6;
            return [cover, overlap, soft];
        }

        function compareScores(a, b) {
            for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
            return 0;
        }

        function clampPosition(x, y, width, height, size) {
            return { x: clamp(x, edgePadding, size.x - width - edgePadding), y: clamp(y, edgePadding, size.y - height - edgePadding) };
        }

        function candidatePositions(point, width, height, size) {
            const out = [];
            const step = 24;
            const maxX = size.x - width - edgePadding;
            const maxY = size.y - height - edgePadding;
            for (let x = edgePadding; x <= maxX; x += step) out.push({ x, y: edgePadding }, { x, y: maxY });
            for (let y = edgePadding; y <= maxY; y += step) out.push({ x: edgePadding, y }, { x: maxX, y });
            out.push({ x: edgePadding, y: edgePadding }, { x: maxX, y: edgePadding }, { x: edgePadding, y: maxY }, { x: maxX, y: maxY });
            for (const gap of [16, 48, 96, 160, 240, 340]) {
                for (let a = 0; a < 16; a++) {
                    const angle = (a / 16) * Math.PI * 2;
                    const x = point.x + Math.cos(angle) * (width / 2 + gap) - width / 2;
                    const y = point.y + Math.sin(angle) * (height / 2 + gap) - height / 2;
                    out.push(clampPosition(x, y, width, height, size));
                }
            }
            return out;
        }

        function inflate(rect) {
            const half = cardGap / 2;
            return { minX: rect.minX - half, minY: rect.minY - half, maxX: rect.maxX + half, maxY: rect.maxY + half };
        }

        function fixedPlacement(model) {
            const saved = cardOffsets.get(model.offsetKey);
            if (saved) {
                const target = L.latLng(model.point.lat + saved.lat, model.point.lng + saved.lng);
                const pixel = toContainer(target);
                return { x: pixel.x, y: pixel.y, anchor: target };
            }
            const cached = autoLayout.get(model.identity);
            if (!cached) return null;
            const pixel = toContainer(cached);
            return { x: pixel.x, y: pixel.y, anchor: cached };
        }

        function placeModel(model, obstacles, placed, size) {
            const width = model.size.width;
            const height = model.size.height;
            const point = toContainer(model.point);
            let best = null, bestScore = null;
            for (const position of candidatePositions(point, width, height, size)) {
                const rect = { minX: position.x, minY: position.y, maxX: position.x + width, maxY: position.y + height };
                const score = scoreRect(rect, point, null, obstacles, placed, size);
                if (!best || compareScores(score, bestScore) < 0) { best = position; bestScore = score; }
            }
            return best;
        }

        function runLayout() {
            if (!selected || !models.length) return;
            const size = map.getSize();
            const obstacles = buildObstacles();
            const placed = panelRects();
            const pending = [];

            for (const model of models) {
                const fixed = fixedPlacement(model);
                if (!fixed) { pending.push(model); continue; }
                model.anchor = fixed.anchor;
                placed.push(inflate({ minX: fixed.x, minY: fixed.y, maxX: fixed.x + model.size.width, maxY: fixed.y + model.size.height }));
            }

            for (const model of pending) {
                const best = placeModel(model, obstacles, placed, size);
                model.anchor = map.containerPointToLatLng(L.point(best.x, best.y));
                autoLayout.set(model.identity, model.anchor);
                placed.push(inflate({ minX: best.x, minY: best.y, maxX: best.x + model.size.width, maxY: best.y + model.size.height }));
            }
        }

        function updateAllConnectors() {
            for (const state of activeCards.values()) {
                if (!state.model.onMap) continue;
                updateConnector(state);
            }
        }

        function nearestCorner(target, left, top, width, height) {
            const corners = [L.point(left, top), L.point(left + width, top), L.point(left, top + height), L.point(left + width, top + height)];
            let best = corners[0], bestDistance = Infinity;
            for (const corner of corners) {
                const distance = corner.distanceTo(target);
                if (distance < bestDistance) {
                    best = corner;
                    bestDistance = distance;
                }
            }
            return best;
        }

        function updateConnector(state) {
            const width = state.card.offsetWidth || state.model.size.width;
            const height = state.card.offsetHeight || state.model.size.height;
            const origin = toContainer(state.marker.getLatLng());
            const target = toContainer(state.model.point);
            const corner = nearestCorner(target, origin.x, origin.y, width, height);
            state.connector.setLatLngs([state.model.point, map.containerPointToLatLng(corner)]);
        }

        function createAddHandler(state) {
            return function () {
                isolateMapEvents(state.marker.getElement());
                state.observer = new ResizeObserver(createResizeHandler(state));
                state.observer.observe(state.card);
                updateConnector(state);
                setTimeout(createLiveHandler(state), 700);
            };
        }
        function createLiveHandler(state) {
            return function () {
                state.card.classList.add('effect-live');
            };
        }
        function createRemoveHandler(state) {
            return function () {
                if (state.observer) {
                    state.observer.disconnect();
                    state.observer = null;
                }
            };
        }
        function createResizeHandler(state) {
            return function () {
                updateConnector(state);
            };
        }
        function createStartReader(state) {
            return function () {
                return toContainer(state.marker.getLatLng());
            };
        }
        function createMover(state) {
            return function (initial, dx, dy) {
                const size = map.getSize();
                const width = state.card.offsetWidth || state.model.size.width;
                const height = state.card.offsetHeight || state.model.size.height;
                const spot = clampPosition(initial.x + dx, initial.y + dy, width, height, size);
                state.marker.setLatLng(map.containerPointToLatLng(L.point(spot.x, spot.y)));
                updateConnector(state);
            };
        }
        function createFinisher(state) {
            return function () {
                const position = state.marker.getLatLng();
                const point = state.model.point;
                cardOffsets.set(state.model.offsetKey, { lat: position.lat - point.lat, lng: position.lng - point.lng });
            };
        }
        function createFronter(state) {
            return function () {
                state.marker.setZIndexOffset(++cardStack * 100000);
            };
        }

        function addCard(model) {
            const { point, card, style, identity, anchor, size, group } = model;
            const connector = L.polyline([point, point], { ...style, className: 'effect-connector' }).addTo(group);
            const iconOptions = { className: 'effect-card-anchor', html: card, iconSize: [size.width, 0], iconAnchor: [0, 0] };
            const markerOptions = { pane: 'effectCardPane', icon: L.divIcon(iconOptions), keyboard: false, bubblingMouseEvents: false };
            const marker = L.marker(anchor, markerOptions);
            const state = { model, marker, connector, card, observer: null };
            activeCards.set(identity, state);
            marker.on('add', createAddHandler(state));
            marker.on('remove', createRemoveHandler(state));
            makeDraggable(card.querySelector('summary'), createStartReader(state), createMover(state), createFinisher(state), createFronter(state));
            marker.addTo(group);
        }

        function onHeaderClick() {
            autoCollapsed = false;
            setCollapsed(!panel.classList.contains('effects-collapsed'));
        }
        function onHeaderKey(event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onHeaderClick();
        }
        function startInspectorDrag(event) {
            const rect = panel.getBoundingClientRect();
            return { grabX: event.clientX - rect.left, grabY: event.clientY - rect.top, startY: event.clientY, dockedAtStart: docked };
        }
        function moveInspector(initial, dx, dy, event) {
            const y = event.clientY;
            const width = panel.offsetWidth;
            panel.style.left = clamp(event.clientX - initial.grabX, 0, window.innerWidth - width) + 'px';
            const dockLine = window.innerHeight - dockDistance;
            let wantDock = docked;
            if (y >= dockLine) wantDock = true;
            else if (docked) {
                const release = initial.dockedAtStart ? initial.startY - 60 : dockLine - 60;
                if (y < release) wantDock = false;
            }
            if (wantDock) {
                if (!docked) dockPanel();
                return;
            }
            if (docked) undockPanel();
            panel.style.top = clamp(y - initial.grabY, 0, window.innerHeight - 60) + 'px';
            panel.style.bottom = 'auto';
        }

        function createInspectorHeader(withColor) {
            const header = element('div', 'effects-header effects-titlebar');
            header.setAttribute('role', 'button');
            header.setAttribute('tabindex', '0');
            header.setAttribute('aria-expanded', panel.classList.contains('effects-collapsed') ? 'false' : 'true');
            header.append(element('div', 'effects-heading', 'Room effects'), element('h2', '', selected.feature.properties.name));
            if (withColor) header.appendChild(createColorToggle());
            header.addEventListener('click', onHeaderClick);
            header.addEventListener('keydown', onHeaderKey);
            makeDraggable(header, startInspectorDrag, moveInspector);
            return header;
        }

        function createColorToggle() {
            const wrapper = element('div', 'effects-option effects-color-option');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = 'effects-color-toggle';
            input.className = 'rw-ui rw-ui-ckb';
            input.autocomplete = 'off';
            input.checked = colorsEnabled;
            input.addEventListener('change', function () {
                colorsEnabled = input.checked;
                saveColors();
                drawObjects();
            });
            const text = element('label', 'rw-text', 'Object colors');
            text.htmlFor = input.id;
            wrapper.append(input, text);
            for (const type of ['pointerdown', 'click', 'keydown']) wrapper.addEventListener(type, stopPropagationOnly);
            return wrapper;
        }
        function stopPropagationOnly(event) {
            event.stopPropagation();
        }

        function effectTypes() {
            const types = new Map();
            for (const item of items()) {
                if (item.category === 'effect') continue;
                if (item.spatial === false) continue;
                const type = types.get(item.key) || { key: item.key, name: item.type };
                types.set(item.key, type);
            }
            return [...types.values()].sort(compareTypeNames);
        }
        function compareTypeNames(a, b) {
            return a.name.localeCompare(b.name);
        }

        function rebuildTypeToggles() {
            if (!typePanel) return;
            typePanel.replaceChildren();
            if (!entry) {
                typePanel.classList.add('effects-type-panel-empty');
                return;
            }
            const types = effectTypes();
            if (!types.length) {
                typePanel.classList.add('effects-type-panel-empty');
                return;
            }

            typePanel.classList.remove('effects-type-panel-empty');
            const keys = types.map(getTypeKey);

            const actions = element('div', 'effects-controls');
            const showAll = button('Show all', () => setTypeVisibility(keys, true));
            showAll.dataset.action = 'show-all';
            const hideAll = button('Hide all', () => setTypeVisibility(keys, false));
            hideAll.dataset.action = 'hide-all';
            actions.append(showAll, hideAll);

            const list = element('div', 'effects-type-list');
            for (const type of types) {
                const toggle = element('button', 'rw-ui effects-type-toggle', type.name);
                toggle.type = 'button';
                toggle.dataset.effectType = type.key;
                toggle.setAttribute('aria-pressed', hiddenTypes.has(type.key) ? 'false' : 'true');
                toggle.addEventListener('click', createTypeToggleHandler(type.key));
                list.appendChild(toggle);
            }

            typePanel.append(actions, list);
            syncTypeToggleStates();
        }
        function getTypeKey(type) {
            return type.key;
        }
        function createTypeToggleHandler(key) {
            return function () {
                setTypeVisibility([key], hiddenTypes.has(key));
            };
        }

        function showInspector(message) {
            panel.replaceChildren();
            panel.hidden = !shouldShowInspector();
            updateTypePanelVisibility();
            updateHideToggle();

            if (!panel.hidden) {
                const body = element('div', 'effects-body');
                const scroll = element('div', 'effects-scroll');
                scroll.appendChild(body);
                const collapse = element('div', 'effects-collapse');
                collapse.appendChild(scroll);
                panel.append(createInspectorHeader(!message), collapse);
                if (message) {
                    body.appendChild(element('p', '', message));
                } else {
                    const warning = getMissingSpatialMessage(selected);
                    if (warning) body.appendChild(element('p', 'effects-note', warning));
                    body.appendChild(element('div', 'effects-room-details'));
                    updateVisibleDetails(visibleItems());
                    const settings = createDetails('Room settings', 'effects-room-settings');
                    appendRows(settings.content, entry.settings, hiddenSettingKeys);
                    body.appendChild(settings);
                }
            }

            rebuildTypeToggles();
            layoutLayerPanel();
        }

        function createResponseHandler(filename, allowMissing) {
            return function (response) {
                if (allowMissing && response.status === 404) return {rooms: {} };
                if (!response.ok) {
                    const prefix = filename === 'index' ? 'Room index: ' : '';
                    throw new Error(prefix + 'HTTP ' + response.status);
                }
                return response.json();
            };
        }
        function createFailureHandler(filename) {
            return function (error) { cache.delete(filename); throw error; };
        }

        function loadJSON(filename, allowMissing = false) {
            if (!cache.has(filename)) {
                const url = 'room-effects/' + filename.split('/').map(encodeURIComponent).join('/') + '.json';
                const request = fetch(url).then(createResponseHandler(filename, allowMissing)).catch(createFailureHandler(filename));
                cache.set(filename, request);
            }
            return cache.get(filename);
        }

        async function loadRoomVariants(region, name, current) {
            let data = await loadJSON(region, true);
            if (current !== version) return;
            if (!data.rooms[name]) {
                const index = await loadJSON('index');
                if (current !== version) return;
                if (index[name] && index[name] !== region) data = await loadJSON(index[name]);
            }
            return data.rooms[name];
        }

        function whenMapIdle(callback) {
            let done = false, timer = null, frames = 0;
            function isMoving() {
                return !!(map._animatingZoom || (map._panAnim && map._panAnim._inProgress));
            }
            function nextFrame(run) {
                let fired = false;
                function once() {
                    if (fired) return;
                    fired = true;
                    run();
                }
                requestAnimationFrame(once);
                setTimeout(once, 50);
            }
            function finish() {
                if (done) return;
                done = true;
                map.off('moveend', onMoveEnd);
                map.off('zoomend', onMoveEnd);
                clearTimeout(timer);
                callback();
            }
            function onMoveEnd() {
                nextFrame(function () {
                    if (done || isMoving()) return;
                    finish();
                });
            }
            function check() {
                if (done) return;
                if (isMoving()) {
                    map.on('moveend', onMoveEnd);
                    map.on('zoomend', onMoveEnd);
                    clearTimeout(timer);
                    timer = setTimeout(finish, 1500);
                    return;
                }
                if (frames++ < 2) {
                    nextFrame(check);
                    return;
                }
                finish();
            }
            nextFrame(check);
        }

        async function select(roomLayer, regionName, context = {}) {
            const current = ++version;
            selected = roomLayer;
            entry = null;
            layer.clearLayers();
            activeCards.clear();
            autoLayout.clear();
            models = [];
            onSelect(context);
            if (!selected) {
                panel.hidden = true;
                updateTypePanelVisibility();
                updateHideToggle();
                rebuildTypeToggles();
                return;
            }
            showInspector('Loading room effects…');

            try {
                const name = selected.feature.properties.name.toUpperCase();
                const variants = await loadRoomVariants(regionName.toUpperCase(), name, current);
                if (current !== version) return;
                entry = variants && pickVariant(variants, context);
                if (!entry) {
                    showInspector('No default room data in the supplied database.');
                    return;
                }
                entry = filterEntry(normalizeEntry(entry), context);
                showInspector();
                whenMapIdle(function () {
                    if (current === version) drawObjects();
                });
            } catch (error) {
                if (current === version) {
                    showInspector('Could not load room effects. Serve the docs folder over HTTP and check the exported JSON files.');
                }
                console.error('Room effects:', error);
            }
        }

        function onWindowResize() {
            if (panel.hidden) return;
            const bounds = panel.getBoundingClientRect();
            positionInspector(bounds.left, bounds.top);
        }

        function onOverlayRemove(event) {
            if (event.layer === layer) {
                layerVisible = false;
                updateTypePanelVisibility();
                updateHideToggle();
                panel.hidden = true;
            }
            layoutLayerPanel();
        }

        function onOverlayAdd(event) {
            if (event.layer === layer) {
                layerVisible = true;
                updateTypePanelVisibility();
                showInspector(entry ? null : 'Select a room to inspect its effects.');
            }
            layoutLayerPanel();
        }

        setupLayerPanel();
        setupHideToggle();
        map.on('zoomend', updateAllConnectors);
        map.on('moveend', updateAllConnectors);
        map.on('overlayremove', onOverlayRemove);
        map.on('overlayadd', onOverlayAdd);
        window.addEventListener('resize', onWindowResize);

        return { select, drawObjects, loadJSON };
    }

    function setupCollapsiblePanel(selector, side, labelText) {
        const panel = document.querySelector(selector);
        if (!panel || panel.dataset.effectsCollapsible) return;
        panel.dataset.effectsCollapsible = '1';
        panel.classList.add('effects-collapsible-panel', 'effects-panel-side-' + side);

        const content = document.createElement('div');
        content.className = 'effects-panel-content';
        while (panel.firstChild) content.appendChild(panel.firstChild);
        panel.appendChild(content);

        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'effects-collapse-tab';
        tab.setAttribute('aria-label', 'Toggle ' + labelText + ' panel');
        tab.setAttribute('aria-expanded', 'true');
        tab.title = 'Collapse / expand ' + labelText;
        for (let i = 0; i < 3; i++) tab.appendChild(document.createElement('span'));
        tab.addEventListener('click', (event) => {
            event.stopPropagation();
            const collapsed = panel.classList.toggle('effects-panel-collapsed');
            tab.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });
        panel.insertBefore(tab, content);

        const label = document.createElement('div');
        label.className = 'effects-collapsed-label';
        label.textContent = labelText;
        label.setAttribute('aria-hidden', 'true');
        panel.appendChild(label);
    }

    function setupCollapsibleSidePanels() {
        setupCollapsiblePanel('.side-panel.left-panel', 'left', 'Regions');
        setupCollapsiblePanel('.side-panel.right-panel', 'right', 'Slugcat / Layers');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupCollapsibleSidePanels);
    } else {
        setupCollapsibleSidePanels();
    }

    window.RoomEffectsCommon = { createRoomEffects, setupCollapsibleSidePanels };
})();