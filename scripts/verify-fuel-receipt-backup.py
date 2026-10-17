#!/usr/bin/env python3
"""Run against an EXTRACTED company-managed ZIP. Never contacts Supabase."""
import argparse, hashlib, json
from pathlib import Path

def verify(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    # ZIP paths include YYYY-MM; manifest resides inside that directory.
    root = manifest_path.parent.parent
    files, seen = [], set()
    for entry in manifest['files']:
        path = (root / entry['name']).resolve()
        if not path.is_relative_to(root) or path in seen:
            raise ValueError('Unsafe or duplicate file path')
        seen.add(path)
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        if path.stat().st_size != entry['bytes'] or digest.hexdigest() != entry['sha256']:
            raise ValueError(f'Backup mismatch: {entry["id"]}')
        files.append({'id': entry['id'], 'sha256': digest.hexdigest()})
    return {'export_id': manifest['export_id'], 'files': files}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = verify(args.manifest)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'PASS: {len(result["files"])} files / SHA-256 and bytes matched')
