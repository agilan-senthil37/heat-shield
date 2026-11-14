"""Validate the derived bundle and write a small, versionable coverage report."""
import datetime
import json
from collections import Counter
from pipeline import ROOT, validate
from environment import validate_environment


def report(bundle):
    validate(bundle)
    validate_environment(bundle)
    rows = []
    for study in bundle['studies']:
        areas = [a for a in bundle['areas'] if a['study_id'] == study['id']]
        rows.append({
            'study': study['name'], 'areas': len(areas),
            'canopy_estimates': sum(a['environment']['canopy_percent'] is not None for a in areas),
            'surface_temperature_estimates': sum(a['environment']['surface_temperature_c'] is not None for a in areas),
            'scored': sum(a['score'] is not None for a in areas),
            'building_mask': dict(Counter(a['environment']['building_mask'] for a in areas)),
            'waterbody_mask': dict(Counter(a['environment'].get('waterbody_mask','unavailable') for a in areas)),
            'conservation_review': dict(Counter(a['environment']['protected_land_review'] for a in areas)),
            'source_errors': dict(Counter(k for a in areas for k in a['environment']['errors'])),
        })
    result = {'validated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'areas': len(bundle['areas']), 'studies': rows,
              'scored': sum(a['score'] is not None for a in bundle['areas']),
              'checks': ['all 11 study areas', 'unique IDs', 'geometry validity',
                         'regional bounds', 'screening geometry containment',
                         'indicator ranges and valid-data fractions'],
              'limitations': ['Satellite-derived surface temperature, not air temperature.',
                              'Source years and scene dates differ.',
                              'Remaining land is unverified, not approved for planting.',
                              'Database migration and load not tested against a live Supabase project.']}
    (ROOT/'environment_build_report.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

if __name__ == '__main__':
    bundle = json.loads((ROOT/'output/environment_bundle.json').read_text())
    result = report(bundle)
    print(json.dumps({'areas':result['areas'],'scored':result['scored'],'studies':result['studies']}))
