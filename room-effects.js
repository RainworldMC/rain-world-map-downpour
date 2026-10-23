(function () {
    'use strict';

    let selectionContext = {};
    let preparedSlugcat = null;

    function hasRoomOrigin(roomLayer) {
        const origin = roomLayer && roomLayer.feature.properties.room_origin;
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

    function currentSlugcat(context) {
        return (context && context.slugcat) || preparedSlugcat || null;
    }

    const api = RoomEffectsCommon.createRoomEffects({
        onSelect: (context) => { selectionContext = context; },
        getOffsetContext: () => currentSlugcat(selectionContext),
        shouldDrawSpatial: hasRoomOrigin,
        getWorldOrigin: (roomLayer) => roomLayer.feature.properties.room_origin,
        getMissingSpatialMessage: (roomLayer) =>
            hasRoomOrigin(roomLayer) ? null : 'Spatial placement is unavailable: this room has no matching terrain reference. Settings are listed below.',
        pickVariant: (variants, context) =>
            window.roomEffectsCharacter
                ? window.roomEffectsCharacter.pickVariant(variants, currentSlugcat(context))
                : variants[''],
        filterEntry: (entry, context) =>
            window.roomEffectsCharacter
                ? window.roomEffectsCharacter.forCharacter(entry, currentSlugcat(context))
                : entry,
    });

    async function prepareRooms(data, slugcat, region) {
        preparedSlugcat = slugcat || null;
        let coordinates;
        try {
            coordinates = await api.loadJSON('coordinates/' + slugcat + '/' + region, true);
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

    window.roomEffects = { select: api.select, prepareRooms };
})();