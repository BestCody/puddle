import importlib.util
import io
import shutil
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('auto_deploy', Path(__file__).parents[2] / 'deploy/self-host/auto-deploy.py')
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)
SHA = 'a' * 40
IMAGE = 'ghcr.io/bestcody/puddle@sha256:' + 'b' * 64


class DeploymentSafety(unittest.TestCase):
    def test_forced_command_rejects_shells_tags_and_other_repositories(self):
        for command in ['bash', 'status; id', f'deploy {SHA} ghcr.io/bestcody/puddle:latest BestCody',
                        f'deploy {SHA} {IMAGE.replace("puddle", "other")} BestCody',
                        f'deploy {SHA} {IMAGE} $(id)']:
            with self.subTest(command=command), self.assertRaises(ValueError):
                deployment.command_args(command, 'BestCody/puddle')
        self.assertEqual(deployment.command_args('status', 'BestCody/puddle'), ['status'])
        self.assertEqual(deployment.command_args(f'deploy {SHA} {IMAGE} BestCody', 'BestCody/puddle')[1], SHA)

    def archive(self, root, name, *, revision=SHA, link=False):
        path = root / 'source.tar.gz'
        with tarfile.open(path, 'w:gz', format=tarfile.PAX_FORMAT, pax_headers={'comment': revision}) as archive:
            entry = tarfile.TarInfo(name)
            if link:
                entry.type = tarfile.SYMTYPE
                entry.linkname = '/etc/passwd'
                archive.addfile(entry)
            else:
                entry.size = 4
                archive.addfile(entry, io.BytesIO(b'test'))
        return path

    def test_archive_rejects_traversal_private_files_links_and_wrong_sha(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['../escape', '/etc/passwd', '.env.selfhost', 'sub/.env.production', '.git/config', 'node_modules/x']:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    deployment.unpack_release(self.archive(root, name), root / 'out', SHA)
            with self.assertRaises(ValueError):
                deployment.unpack_release(self.archive(root, 'linked', link=True), root / 'out', SHA)
            with self.assertRaises(ValueError):
                deployment.unpack_release(self.archive(root, 'app/page.js', revision='c' * 40), root / 'out', SHA)
            deployment.unpack_release(self.archive(root, 'app/page.js'), root / 'out', SHA)
            self.assertEqual((root / 'out/app/page.js').read_bytes(), b'test')

    def test_new_modified_deleted_migrations_and_infrastructure_require_review(self):
        with tempfile.TemporaryDirectory() as directory:
            app, source = Path(directory) / 'app', Path(directory) / 'source'
            for root in [app, source]:
                (root / 'supabase/migrations').mkdir(parents=True)
                (root / 'supabase/migrations/old.sql').write_text('select 1;')
            deployment.manual_change_guard(app, source)
            new = source / 'supabase/migrations/new.sql'
            new.write_text('select 2;')
            with self.assertRaises(ValueError):
                deployment.manual_change_guard(app, source)
            new.unlink()
            old = source / 'supabase/migrations/old.sql'
            old.write_text('drop table data;')
            with self.assertRaises(ValueError):
                deployment.manual_change_guard(app, source)
            old.unlink()
            with self.assertRaises(ValueError):
                deployment.manual_change_guard(app, source)
            old.write_text('select 1;')
            config = source / 'deploy/self-host/compose.yaml'
            config.parent.mkdir(parents=True)
            config.write_text('services: changed')
            with self.assertRaises(ValueError):
                deployment.manual_change_guard(app, source)

    def test_build_config_digest_is_order_independent_but_detects_origin_changes(self):
        first = {'SITE': 'https://puddle.you', 'API': 'https://api.puddle.you'}
        self.assertEqual(deployment.config_digest(first), deployment.config_digest(dict(reversed(list(first.items())))))
        self.assertNotEqual(deployment.config_digest(first), deployment.config_digest(dict(first, SITE='https://other.test')))

    @unittest.skipUnless(shutil.which('rsync'), 'rsync is exercised on the Linux deploy target/CI')
    def test_real_source_sync_deletes_retired_code_but_preserves_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / 'source', Path(directory) / 'target'
            source.mkdir()
            target.mkdir()
            (source / 'current.js').write_text('new release')
            (target / 'retired.js').write_text('old release')
            (target / '.env.production').write_text('private-test-fixture')
            (target / '.venv').mkdir()
            (target / '.venv/worker').write_text('worker dependencies')
            (target / '.env.selfhost').symlink_to('.env.production')
            for root, body in [(source, 'pending worker release'), (target, 'running worker release')]:
                (root / 'scripts/global-data').mkdir(parents=True)
                (root / 'scripts/global-data/job.py').write_text(body)
                (root / 'scripts/self-host-run-data-job.mjs').write_text(body)
                (root / 'deploy/self-host').mkdir(parents=True)
                (root / 'deploy/self-host/puddle-data@kartaview.timer').write_text(body)
                (root / 'deploy/self-host/data-jobs-requirements.txt').write_text(body)
            deployment.sync_source(source, target)
            self.assertFalse((target / 'retired.js').exists())
            self.assertEqual((target / 'current.js').read_text(), 'new release')
            self.assertTrue((target / '.env.selfhost').is_symlink())
            self.assertEqual((target / '.env.selfhost').read_text(), 'private-test-fixture')
            self.assertEqual((target / '.venv/worker').read_text(), 'worker dependencies')
            for name in ['scripts/global-data/job.py', 'scripts/self-host-run-data-job.mjs',
                         'deploy/self-host/puddle-data@kartaview.timer', 'deploy/self-host/data-jobs-requirements.txt']:
                self.assertEqual((target / name).read_text(), 'running worker release')


if __name__ == '__main__':
    unittest.main()
