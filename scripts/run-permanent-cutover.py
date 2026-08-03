from pathlib import Path
import runpy

script = Path('scripts/permanent-location-first-cutover.py')
content = script.read_text(encoding='utf-8')
start = content.index('old = """let releases')
end = content.index('"""', start + 9) + 3
replacement = '''old = """let releases = registry.releases.map((item) => item?.release).filter(Boolean)
if (!releases.length) {
  const releaseObjects = await allObjects('catalogue/releases/')
  releases = [...new Set(releaseObjects.map((object) => object.key.split('/')[2]).filter(Boolean))].sort().reverse()
}"""'''
script.write_text(content[:start] + replacement + content[end:], encoding='utf-8')
runpy.run_path(str(script), run_name='__main__')
