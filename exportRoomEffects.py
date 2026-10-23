"""Export SQLite room effects as static, per-region JSON for the map.

Run: python exportRoomEffects.py [database] [output-directory]
No third-party dependencies or database writes are required.

Timeline keys produced by this exporter match room-effects-character.js's
timelineSuffix(): "", "White", "Yellow", "Red", "Gourmand", "Artificer",
"Rivulet", "Spear", "Saint", "Inv", "Watcher".
"""
import argparse
import json
import sqlite3
from pathlib import Path

TIMELINE_ALIASES = {
    'survivor': 'white',
    'monk': 'yellow',
    'hunter': 'red',
    'spearmaster': 'spear',
    'sofanthiel': 'inv',
}


def normalize_timeline(value):
    """Keep DB timeline suffixes aligned with the JS side."""
    if value is None:
        return ''
    key = str(value).strip().lower()
    key = TIMELINE_ALIASES.get(key, key)
    if not key:
        return ''
    if key == 'inv':
        return 'Inv'
    return key[0].upper() + key[1:]


def parse_shared_timelines(shared):
    if not shared:
        return []
    return [normalize_timeline(p) for p in shared.split(',') if p.strip()]


def empty_entry():
    return {'settings': {}, 'effects': [], 'objects': [], 'sounds': [], 'triggers': []}


def export(database, output, exclude_modded=False):
    output.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row

        existing = {r[0] for r in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}

        regions = {}
        stats = {'rows': 0, 'variants': 0, 'skipped_modded': 0}

        # --- room settings (one row per timeline variant) ---
        for row in connection.execute(
                'SELECT * FROM room_settings ORDER BY room_name, timeline'):
            data = dict(row)
            region = data.pop('region_name')
            room = data.pop('room_name')
            timeline = normalize_timeline(data.pop('timeline', ''))
            shared = data.pop('shared_timelines', '') or ''
            modded = data.pop('modded', 0) or 0
            mod_id = data.pop('mod_id', None)

            if exclude_modded and modded:
                stats['skipped_modded'] += 1
                continue

            timelines = parse_shared_timelines(shared)
            settings = {k: v for k, v in data.items() if v is not None and v != ''}

            entry = {
                'settings': settings,
                'effects': [], 'objects': [], 'sounds': [], 'triggers': [],
            }
            if timelines:
                entry['timelines'] = timelines
            if modded:
                entry['modded'] = True
                if mod_id:
                    entry['mod_id'] = mod_id

            regions.setdefault(region.upper(), {}).setdefault(
                room.upper(), {})[timeline] = entry
            stats['rows'] += 1

        # --- effects / objects / sounds / triggers ---
        for table, target, index in [
            ('room_setting_effects', 'effects', 'effect_index'),
            ('room_placed_objects', 'objects', 'object_index'),
            ('room_ambient_sounds', 'sounds', 'sound_index'),
            ('room_triggers', 'triggers', 'trigger_index'),
        ]:
            if table not in existing:
                continue
            order = f"region_name, room_name, timeline, {index}"
            for row in connection.execute(
                    f"SELECT * FROM {table} WHERE owner_kind='room' ORDER BY {order}"):
                data = dict(row)
                region = data['region_name'].upper()
                room = data['room_name'].upper()
                timeline = normalize_timeline(data.get('timeline', ''))

                rooms = regions.setdefault(region, {}).setdefault(room, {})
                if timeline not in rooms:
                    # Stub if the settings row was filtered out (modded, missing…)
                    rooms[timeline] = empty_entry()
                entry = rooms[timeline]

                if table == 'room_placed_objects':
                    if data.get('placed_json'):
                        try:
                            obj = json.loads(data['placed_json'])
                        except json.JSONDecodeError:
                            continue
                        obj['object_index'] = data['object_index']
                        entry['objects'].append(obj)
                    else:
                        entry['objects'].append({
                            k: v for k, v in data.items()
                            if v is not None and k not in (
                                'owner_kind', 'region_name', 'room_name',
                                'template_name', 'timeline')})
                else:
                    item = {k: v for k, v in data.items() if v is not None and k not in (
                        'owner_kind', 'region_name', 'room_name',
                        'template_name', 'timeline')}
                    if table == 'room_setting_effects' and 'ripple_json' in item:
                        ripple = item.pop('ripple_json', None)
                        if ripple:
                            try:
                                item['ripple'] = json.loads(ripple)
                            except Exception:
                                pass
                    entry[target].append(item)

        # --- headers ---
        if 'room_headers' in existing:
            for row in connection.execute(
                    'SELECT room_name, region_name, header_json FROM room_headers'):
                r_name = row['region_name'].upper()
                rm_name = row['room_name'].upper()
                try:
                    header = json.loads(row['header_json'])
                except Exception:
                    continue
                for variant in regions.get(r_name, {}).get(rm_name, {}).values():
                    variant['header'] = header

        # --- creature spawns ---
        if 'room_creature_spawns' in existing:
            for row in connection.execute(
                    "SELECT * FROM room_creature_spawns WHERE offscreen=0 ORDER BY spawn_index"):
                data = dict(row)
                timeline = normalize_timeline(data.get('timeline', ''))
                entry = (regions
                         .get(data['region_name'].upper(), {})
                         .get(data['room_name'].upper(), {})
                         .get(timeline))
                if entry is None:
                    continue
                entry.setdefault('spawns', []).append({
                    'den': data['den'],
                    'creature_type': data['creature_type'],
                    'amount': data['amount'],
                    'spawn_data': data.get('spawn_data'),
                })

        # --- lineages ---
        if 'room_lineages' in existing:
            stages = {}
            if 'room_lineage_stages' in existing:
                for s_row in connection.execute(
                        "SELECT * FROM room_lineage_stages WHERE room_name != '' "
                        "ORDER BY lineage_index, stage_index"):
                    s = dict(s_row)
                    key = (s['region_name'].upper(), s['room_name'].upper(),
                           normalize_timeline(s.get('timeline', '')),
                           s['lineage_index'])
                    stages.setdefault(key, []).append({
                        'stage_index': s['stage_index'],
                        'creature_type': s['creature_type'],
                        'progression_chance': s['progression_chance'],
                        'spawn_data': s.get('spawn_data'),
                    })
            for row in connection.execute(
                    "SELECT * FROM room_lineages WHERE offscreen=0 ORDER BY lineage_index"):
                data = dict(row)
                timeline = normalize_timeline(data.get('timeline', ''))
                entry = (regions
                         .get(data['region_name'].upper(), {})
                         .get(data['room_name'].upper(), {})
                         .get(timeline))
                if entry is None:
                    continue
                key = (data['region_name'].upper(), data['room_name'].upper(),
                       timeline, data['lineage_index'])
                entry.setdefault('lineages', []).append({
                    'den': data['den'],
                    'night_creature': bool(data['night_creature']),
                    'conflict_index': data['conflict_index'],
                    'stages': stages.get(key, []),
                })

        # --- write per-region files ---
        for region, rooms in sorted(regions.items()):
            stats['variants'] += sum(len(v) for v in rooms.values())
            (output / (region + '.json')).write_text(
                json.dumps({'rooms': rooms}, separators=(',', ':'),
                           ensure_ascii=True, allow_nan=False),
                encoding='utf-8')

        # --- index (prefer owners with real settings) ---
        index = {name: region for region, rooms in regions.items() for name in rooms}
        index.update({
            name: region
            for region, rooms in regions.items()
            for name, variants in rooms.items()
            if any(v.get('settings') for v in variants.values())
        })
        (output / 'index.json').write_text(
            json.dumps(index, separators=(',', ':')), encoding='utf-8')

        print(f"Exported {stats['rows']} room rows across {len(regions)} regions "
              f"({stats['variants']} total variants) to {output}")
        if stats['skipped_modded']:
            print(f"Skipped {stats['skipped_modded']} modded room rows")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', nargs='?', type=Path, default=Path('rainworld-rooms.db'))
    parser.add_argument('output', nargs='?', type=Path, default=Path('room-effects'))
    parser.add_argument('--exclude-modded', action='store_true', help='Skip rooms contributed by mods')
    args = parser.parse_args()
    export(args.database, args.output, args.exclude_modded)