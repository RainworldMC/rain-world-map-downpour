(function (root) {
    'use strict';

    const aliases = {
        survivor: 'white',
        monk: 'yellow',
        hunter: 'red',
        spearmaster: 'spear',
        sofanthiel: 'inv',
    };
    const filterImmuneTypes = new Set([
        'CUSTOM_DECAL', 'FILTER', 'RIPPLE_LEVEL_FILTER', 'PRINCE_FILTER',
        'RIPPLE_EGG_FILTER', 'WARP_FILTER', 'SUPER_SLOPE', 'CURVED_SLOPE',
        'LOCAL_TERRAIN', 'TERRAIN_HANDLE',
    ]);

    function characterKey(value) {
        const name = String(value).trim().toLowerCase();
        return aliases[name] || name;
    }

    function allows(availability, character) {
        if (availability === undefined || availability === null) {
            return true;
        }
        const names = Array.isArray(availability) ? availability : availability.split(',');
        return names.some(name => characterKey(name) === character);
    }

    function objectAvailability(object) {
        return object.data_available_on_timelines ?? object.data_available_to_players;
    }

    function contains(filter, object) {
        const values = [filter.pos_x, filter.pos_y, object.pos_x, object.pos_y];
        const hx = filter.data_handle_x ?? 0;
        const hy = filter.data_handle_y ?? 0;
        if (![...values, hx, hy].every(Number.isFinite)) {
            return false;
        }
        const dx = object.pos_x - filter.pos_x;
        const dy = object.pos_y - filter.pos_y;
        return dx * dx + dy * dy < hx * hx + hy * hy;
    }

    function forCharacter(entry, slugcat) {
        if (!slugcat) {
            return entry;
        }
        const character = characterKey(slugcat);
        const excludedZones = entry.objects.filter(object =>
            object.object_type === 'FILTER' && !allows(objectAvailability(object), character)
        );
        const objects = entry.objects.filter(object => {
            if (filterImmuneTypes.has(object.object_type)) {
                return true;
            }
            return allows(objectAvailability(object), character) &&
                !excludedZones.some(filter => contains(filter, object));
        });
        const triggers = (entry.triggers || []).filter(trigger => allows(trigger.slugcats, character));
        return { ...entry, objects, triggers };
    }

    const api = { forCharacter };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.roomEffectsCharacter = api;
    }
})(globalThis);
