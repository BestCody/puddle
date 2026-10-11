#!/usr/bin/env python3
"""Root-owned, forced-command receiver for CI app releases (not a login shell)."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import zlib
from urllib.parse import urlsplit

CONFIG = Path('/etc/puddle/deploy.json')
STATE = Path('/var/lib/puddle-deploy')
OVERRIDE = Path('/etc/puddle/release.compose.json')
PUBLIC_KEYS = (
    'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
)
PRESERVE = ('.env*', '.venv/', '.git/', 'node_modules/', '.next/', '.e2e-local/', '__pycache__/')
MANUAL_FILES = (
    'deploy/self-host/compose.yaml', 'deploy/self-host/Caddyfile',
    'deploy/self-host/supabase-compose.override.yaml',
)
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_EXPANDED_BYTES = 1024 * 1024 * 1024


def command_args(command, repository):
    args = shlex.split(command)
    if args == ['status']:
        return args
    if (len(args) == 4 and args[0] == 'deploy'
            and re.fullmatch(r'[0-9a-f]{40}', args[1])
            and re.fullmatch(re.escape(f'ghcr.io/{repository.lower()}@sha256:') + r'[0-9a-f]{64}', args[2])
            and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,99}(?:\[bot\])?', args[3])):
        return args
    raise ValueError('Only status or a digest-pinned Puddle release is permitted.')


def run(args, *, env=None, input=None, capture=False, timeout=600):
    try:
        result = subprocess.run(args, env=env, input=input, text=True, timeout=timeout,
                                stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                                stderr=subprocess.PIPE)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f'{args[0]} operation timed out.') from None
    if result.returncode:
        # Docker config/compose diagnostics can contain credentials. Do not relay them.
        raise RuntimeError(f'{args[0]} operation failed (exit {result.returncode}).')
    return result.stdout if capture else None


def compose(app, override=None):
    args = ['docker', 'compose', '--project-name', 'self-host', '--env-file',
            str(app / '.env.selfhost'), '-f', str(app / 'deploy/self-host/compose.yaml')]
    if override and override.exists():
        args += ['-f', str(override)]
    return args


def atomic_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data), encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(path)


def release_override(image, sha):
    return {'services': {'app': {'image': image, 'environment': {'PUDDLE_BUILD_SHA': sha}}}}


def public_config(app):
    config = json.loads(run(compose(app) + ['config', '--format', 'json'], capture=True))
    args = config['services']['app']['build']['args']
    return {key: str(args.get(key) or '') for key in PUBLIC_KEYS}


def config_digest(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def unpack_release(archive_path, destination, sha):
    with tarfile.open(archive_path, 'r:gz') as archive:
        if archive.pax_headers.get('comment') != sha:
            raise ValueError('Source archive revision does not match the requested release.')
        members = archive.getmembers()
        if sum(member.size for member in members) > MAX_EXPANDED_BYTES:
            raise ValueError('Expanded source archive is too large.')
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or '..' in path.parts or not path.parts
                    or not (member.isfile() or member.isdir())
                    or any((part.startswith('.env') and part != '.env.example') or part in {'.git', '.venv', 'node_modules', '.next'}
                           for part in path.parts)):
                raise ValueError('Source archive contains an unsafe or private entry.')
        archive.extractall(destination, members=members, filter='data')


def file_digest(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest() if path.is_file() else None


def manual_change_guard(app, source):
    for name in MANUAL_FILES:
        if file_digest(app / name) != file_digest(source / name):
            raise ValueError(f'{name} changed; review/apply infrastructure configuration separately.')
    def migrations(root):
        return {str(path.relative_to(root)): file_digest(path)
                for path in (root / 'supabase/migrations').glob('*.sql')}
    if migrations(app) != migrations(source):
        raise ValueError('Database migrations differ from the host; apply reviewed migrations before deploying.')


def sync_source(source, destination):
    args = ['rsync', '-a', '--delete']
    for name in PRESERVE:
        args += ['--exclude', name]
    run(args + [str(source) + '/', str(destination) + '/'])


def health(container, sha):
    script = ("fetch('http://127.0.0.1:3000/api/health').then(async r=>{const b=await r.json();"
              "if(!r.ok||!b.ok||!b.authConfigured||!b.supabaseTransportConfigured||"
              "b.buildSha!==process.argv[1])process.exit(1)}).catch(()=>process.exit(1))")
    for _ in range(60):
        try:
            run(['docker', 'exec', container, 'node', '-e', script, sha], timeout=5)
            return
        except RuntimeError:
            time.sleep(1)
    raise RuntimeError('App did not pass the private health/revision gate.')


def active_release():
    data = json.loads(run(['docker', 'inspect', 'self-host-app-1'], capture=True))[0]
    env = dict(value.split('=', 1) for value in data['Config']['Env'] if '=' in value)
    return {'sha': env.get('PUDDLE_BUILD_SHA'), 'image': data['Config']['Image']}


def deploy(app, sha, image, actor):
    import fcntl
    if app != Path('/opt/puddle') or app.is_symlink() or not app.is_dir():
        raise ValueError('Release target must be the existing /opt/puddle directory.')
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix='release-', dir=STATE) as temporary:
            work = Path(temporary)
            token = sys.stdin.buffer.readline(4096).decode().strip()
            if not token or len(token) > 2048:
                raise ValueError('An ephemeral CI registry token is required.')
            archive = work / 'source.tar.gz'
            total = 0
            with archive.open('wb') as output:
                while chunk := sys.stdin.buffer.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_ARCHIVE_BYTES:
                        raise ValueError('Source archive is too large.')
                    output.write(chunk)
            source = work / 'source'
            source.mkdir()
            unpack_release(archive, source, sha)
            manual_change_guard(app, source)
            registry = work / 'docker'
            registry.mkdir(mode=0o700)
            env = dict(os.environ, DOCKER_CONFIG=str(registry))
            run(['docker', 'login', 'ghcr.io', '--username', actor, '--password-stdin'],
                env=env, input=token + '\n')
            token = None
            run(['docker', 'pull', '--quiet', image], env=env)
            info = json.loads(run(['docker', 'image', 'inspect', image], capture=True))[0]
            labels = info['Config'].get('Labels') or {}
            if (labels.get('org.opencontainers.image.revision') != sha
                    or labels.get('you.puddle.public-config') != config_digest(public_config(app))):
                raise ValueError('Image revision/public build configuration does not match this host.')
            candidate = f'puddle-release-check-{sha[:12]}'
            candidate_override = work / 'candidate.json'
            atomic_json(candidate_override, release_override(image, sha))
            try:
                run(compose(app, candidate_override) + ['run', '--no-deps', '--pull', 'never',
                    '-d', '--name', candidate, 'app'], env=env)
                health(candidate, sha)
            finally:
                subprocess.run(['docker', 'rm', '-f', candidate], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL)
            # Share the workers' existing lock only for activation, not downloads/builds.
            with Path('/var/lib/puddle-jobs/global.lock').open('a') as jobs:
                fcntl.flock(jobs, fcntl.LOCK_EX)
                previous = active_release()
                health('self-host-app-1', previous['sha'])
                old_source = work / 'previous'
                old_source.mkdir()
                sync_source(app, old_source)
                try:
                    sync_source(source, app)
                    atomic_json(OVERRIDE, release_override(image, sha))
                    run(compose(app, OVERRIDE) + ['up', '-d', '--no-build', '--no-deps',
                        '--pull', 'never', '--wait', '--wait-timeout', '120', 'app'], env=env)
                    health('self-host-app-1', sha)
                    site = public_config(app)['NEXT_PUBLIC_SITE_URL']
                    public = json.loads(run(['curl', '--fail', '--silent', '--show-error',
                        '--max-time', '20', '--resolve', f'{urlsplit(site).hostname}:443:127.0.0.1',
                        site.rstrip('/') + '/api/health'], capture=True))
                    if not public.get('ok') or public.get('buildSha') != sha:
                        raise RuntimeError('Proxy/public revision gate failed.')
                except Exception:
                    sync_source(old_source, app)
                    atomic_json(OVERRIDE, release_override(previous['image'], previous['sha']))
                    run(compose(app, OVERRIDE) + ['up', '-d', '--no-build', '--no-deps',
                        '--pull', 'never', '--wait', '--wait-timeout', '120', 'app'])
                    raise
                atomic_json(STATE / 'current.json', {'sha': sha, 'image': image, 'deployed_at': int(time.time())})
            print(json.dumps({'deployed': True, 'sha': sha, 'image': image}))


def main():
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    args = command_args(os.environ.get('SSH_ORIGINAL_COMMAND', ''), config['repository'])
    if args == ['status']:
        print(json.dumps(active_release()))
    else:
        deploy(Path(config['app_dir']), *args[1:])


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise RuntimeError('Deployment interrupted; cleaning up the release.')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except (ValueError, RuntimeError, OSError, tarfile.TarError, EOFError, zlib.error) as error:
        print(f'Deployment refused/failed: {error}', file=sys.stderr)
        sys.exit(1)
