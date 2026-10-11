#!/usr/bin/env python3
"""One-time root installation; never executed by the CI deployment key."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repository')
    parser.add_argument('--public-key', type=Path)
    parser.add_argument('--print-public-config', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run this one-time installer as root.')
    app = Path('/opt/puddle')
    receiver = Path(__file__).with_name('auto-deploy.py')
    spec = importlib.util.spec_from_file_location('receiver', receiver)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if args.print_public_config:
        print(json.dumps(module.public_config(app)))
        return
    if not args.repository or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository):
        parser.error('Supply owner/repository.')
    if not args.public_key:
        parser.error('Supply the dedicated deployment public key.')
    key = args.public_key.read_text(encoding='utf-8').strip()
    if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [A-Za-z0-9_.@-]+)?', key):
        parser.error('Expected one Ed25519 public key, not a private key or authorized_keys options.')
    # Ensure the target really is this running stack before installing access.
    module.public_config(app)
    for name in ['/etc/puddle', '/usr/local/lib/puddle', '/var/lib/puddle-deploy']:
        path = Path(name)
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.chmod(0o700)
    shutil.copyfile(receiver, '/usr/local/lib/puddle/auto-deploy.py')
    Path('/usr/local/lib/puddle/auto-deploy.py').chmod(0o700)
    module.atomic_json(module.CONFIG, {'repository': args.repository, 'app_dir': str(app)})
    ssh = Path('/root/.ssh')
    ssh.mkdir(mode=0o700, exist_ok=True)
    ssh.chmod(0o700)
    authorized = ssh / 'authorized_keys'
    existing = authorized.read_text(encoding='utf-8') if authorized.exists() else ''
    forced = 'restrict,command="/usr/bin/timeout 1800 /usr/bin/python3 /usr/local/lib/puddle/auto-deploy.py" '
    if key.split()[1] not in existing:
        authorized.write_text(existing.rstrip() + '\n' + forced + key + '\n', encoding='utf-8')
    authorized.chmod(0o600)
    (app / '.env.selfhost').chmod(0o600)
    print('Restricted Contabo deployment receiver installed; existing SSH keys preserved.')


if __name__ == '__main__':
    main()
